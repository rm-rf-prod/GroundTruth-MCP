import { CACHE_TTLS } from "../constants.js";
import type { FetchResult } from "../types.js";
import { docCache, diskDocCache } from "./cache.js";
import { convertHtmlToMarkdown } from "../utils/html-to-md.js";
import { cacheDoc, hashContent } from "./http/request.js";
import { tryFetch } from "./http/try-fetch.js";
import { fetchViaJina } from "./http/jina.js";
import { followNestedLlmsIndex } from "./llms-index.js";
import { isGarbageContent } from "./content-guards.js";

/**
 * Single-flight wrapper around the docs pipeline.
 *
 * Every other fetch entry point already dedups via `inFlightRequests`; this one
 * did not, so two concurrent gt_get_docs / gt_auto_scan calls for the same
 * library each ran the full llms.txt -> discovery -> Jina -> GitHub chain.
 */
const inFlightDocs = new Map<string, Promise<FetchResult>>();

export async function fetchDocs(
  docsUrl: string,
  llmsTxtUrl?: string,
  llmsFullTxtUrl?: string,
  topic?: string,
): Promise<FetchResult> {
  const key = `docs:${docsUrl}`;
  const inFlight = inFlightDocs.get(key);
  if (inFlight) return inFlight;

  const pending = fetchDocsUncached(docsUrl, llmsTxtUrl, llmsFullTxtUrl, topic);
  inFlightDocs.set(key, pending);
  try {
    return await pending;
  } finally {
    inFlightDocs.delete(key);
  }
}

async function fetchDocsUncached(
  docsUrl: string,
  llmsTxtUrl?: string,
  llmsFullTxtUrl?: string,
  _topic?: string,
): Promise<FetchResult> {
  const cacheKey = `docs:${docsUrl}`;
  const sourceTypeKey = `${cacheKey}:sourceType`;
  const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set(["llms-txt", "llms-full-txt", "jina", "direct"]);

  function stamp(result: FetchResult): FetchResult {
    return { ...result, contentHash: hashContent(result.content), fetchedAt: new Date().toISOString() };
  }

  // Cache hits must report the ORIGINAL fetch origin, not a hardcoded
  // "llms-txt" — quality scoring downstream weights source types differently.
  // Companion entry absent (pre-fix cache files) falls back to llms-txt.
  function asSourceType(raw: string | null | undefined): FetchResult["sourceType"] {
    return raw && VALID_SOURCE_TYPES.has(raw) ? (raw as FetchResult["sourceType"]) : "llms-txt";
  }

  function cacheDocsResult(content: string, ttl: number, sourceType: FetchResult["sourceType"]): void {
    cacheDoc(cacheKey, content, ttl);
    docCache.set(sourceTypeKey, sourceType, ttl);
    void diskDocCache.set(sourceTypeKey, sourceType, ttl);
  }

  const memCached = docCache.get(cacheKey);
  if (memCached) {
    return stamp({ content: memCached, url: docsUrl, sourceType: asSourceType(docCache.get(sourceTypeKey)) });
  }

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    const st = asSourceType(await diskDocCache.get(sourceTypeKey));
    docCache.set(sourceTypeKey, st);
    return stamp({ content: diskCached, url: docsUrl, sourceType: st });
  }

  // 1. Race llms-full.txt and llms.txt in parallel (both are cheap GETs)
  if (llmsFullTxtUrl || llmsTxtUrl) {
    const candidates: Array<{ url: string; sourceType: FetchResult["sourceType"] }> = [];
    if (llmsFullTxtUrl) candidates.push({ url: llmsFullTxtUrl, sourceType: "llms-full-txt" });
    if (llmsTxtUrl) candidates.push({ url: llmsTxtUrl, sourceType: "llms-txt" });

    const results = await Promise.all(
      candidates.map(async (c) => ({ ...c, content: await tryFetch(c.url) })),
    );

    // Prefer llms-full.txt > llms.txt
    for (const r of results) {
      if (r.content) {
        if (r.sourceType === "llms-txt") {
          const nested = await followNestedLlmsIndex(r.content, r.url);
          if (nested) {
            cacheDocsResult(nested.content, CACHE_TTLS.LLMS_TXT, "llms-txt");
            return stamp({ content: nested.content, url: nested.url, sourceType: "llms-txt" });
          }
        }
        cacheDocsResult(r.content, CACHE_TTLS.LLMS_TXT, r.sourceType);
        return stamp({ content: r.content, url: r.url, sourceType: r.sourceType });
      }
    }

    // Auto-discover from the domain root of the provided llms.txt URL
    if (llmsTxtUrl) {
      try {
        const origin = new URL(llmsTxtUrl).origin;
        const autoUrl = `${origin}/llms.txt`;
        const autoDiscovered = await tryFetch(autoUrl);
        if (autoDiscovered) {
          const nested = await followNestedLlmsIndex(autoDiscovered, autoUrl);
          const final = nested ?? { content: autoDiscovered, url: autoUrl };
          cacheDocsResult(final.content, CACHE_TTLS.LLMS_TXT, "llms-txt");
          return stamp({ content: final.content, url: final.url, sourceType: "llms-txt" });
        }
      } catch { /* invalid URL */ }
    }
  }

  // 2. Race auto-discover + direct HTML extraction + Jina — first good result wins
  const autoDiscoverUrls: string[] = [];
  try {
    const origin = new URL(docsUrl).origin;
    autoDiscoverUrls.push(
      `${origin}/llms.txt`,
      `${origin}/llms-full.txt`,
      `${origin}/docs/llms.txt`,
      `${origin}/docs/llms-full.txt`,
    );
  } catch { /* invalid URL */ }

  const candidates: Array<Promise<FetchResult>> = [];
  for (const adUrl of autoDiscoverUrls) {
    candidates.push(
      tryFetch(adUrl).then((c) => {
        if (c) return { content: c, url: adUrl, sourceType: "llms-txt" as const };
        throw new Error("no content");
      }),
    );
  }
  // Direct HTML fetch + extraction (fast, no Jina dependency)
  candidates.push(
    (async () => {
      const html = await tryFetch(docsUrl, 0);
      if (!html) throw new Error("no content");
      const tagDensity = (html.match(/<[a-z]/gi) ?? []).length / Math.max(html.length, 1);
      // Already plain text / markdown
      if (tagDensity < 0.005 && html.length > 100) {
        if (isGarbageContent(html).garbage) throw new Error("garbage content");
        return { content: html, url: docsUrl, sourceType: "direct" as const };
      }
      const md = convertHtmlToMarkdown(html);
      if (md.length >= 200) {
        if (isGarbageContent(md).garbage) throw new Error("garbage content after extraction");
        return { content: md, url: docsUrl, sourceType: "direct" as const };
      }
      throw new Error("extraction too short");
    })(),
  );
  // Jina Reader (handles JS-rendered sites)
  candidates.push(
    fetchViaJina(docsUrl).then((c) => {
      if (c) return { content: c, url: docsUrl, sourceType: "jina" as const };
      throw new Error("no content");
    }),
  );

  try {
    const hit = await Promise.any(candidates);
    cacheDocsResult(hit.content, CACHE_TTLS.DOCS_PAGE, hit.sourceType);
    return stamp(hit);
  } catch {
    // All candidates failed — fall through to error
  }

  throw new Error(`Failed to fetch documentation from ${docsUrl}`);
}
