import { CACHE_TTLS } from "../../constants.js";
import { docCache, diskDocCache } from "../cache.js";
import { convertHtmlToMarkdown } from "../../utils/html-to-md.js";
import { cacheDoc, inFlightRequests } from "./request.js";
import { tryFetch } from "./try-fetch.js";
import { fetchViaJina } from "./jina.js";
import { isGarbageContent } from "../content-guards.js";

/**
 * Docsify sites address pages via hash fragments (https://getpino.io/#/docs/web)
 * that never reach the server — a direct fetch always lands on the homepage
 * shell regardless of the fragment. The markdown source conventionally lives at
 * the fragment path + ".md" on the same origin/base path. Returns null for
 * non-hash-routed URLs.
 */
export function docsifyToRaw(url: string): string | null {
  const m = /^(https?:\/\/[^#]*?)\/?#\/(.+)$/.exec(url);
  if (!m) return null;
  const base = m[1]!;
  let frag = m[2]!.replace(/[?].*$/, "").replace(/\/+$/, "");
  if (!frag) return null;
  if (!/\.(md|markdown)$/i.test(frag)) frag += ".md";
  return `${base}/${frag}`;
}

/**
 * Fetch a URL as markdown, trying direct HTML extraction first (fast, no Jina dependency),
 * then falling back to Jina Reader for JS-rendered pages.
 * This is the core reliability improvement — provides two independent paths to content.
 */
export async function fetchAsMarkdown(url: string): Promise<string | null> {
  const cacheKey = `md:${url}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  // Deduplicate concurrent requests
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    // Path 0: Docsify hash-route URLs — the fragment never reaches the server,
    // so a direct fetch would return the homepage shell for EVERY page. Try the
    // conventional raw-markdown location first; skip the direct path entirely.
    const docsifyRaw = docsifyToRaw(url);
    if (docsifyRaw) {
      const rawMd = await tryFetch(docsifyRaw, 1);
      if (rawMd && rawMd.length >= 200 && !isGarbageContent(rawMd).garbage) {
        cacheDoc(cacheKey, rawMd, CACHE_TTLS.DOCS_PAGE);
        return rawMd;
      }
      // Hash-routed page without raw .md — only Jina can render it correctly.
      const jinaHash = await fetchViaJina(url);
      if (jinaHash && jinaHash.length >= 100) {
        cacheDoc(cacheKey, jinaHash, CACHE_TTLS.DOCS_PAGE);
        return jinaHash;
      }
      return null;
    }

    // Path 1: Direct fetch + HTML-to-Markdown extraction (fast, no Jina)
    const directHtml = await tryFetch(url, 1);
    if (directHtml) {
      // Check if it's already markdown/plain text (llms.txt, README)
      const tagDensity = (directHtml.match(/<[a-z]/gi) ?? []).length / Math.max(directHtml.length, 1);
      if (tagDensity < 0.005 && directHtml.length > 100 && !isGarbageContent(directHtml).garbage) {
        cacheDoc(cacheKey, directHtml, CACHE_TTLS.DOCS_PAGE);
        return directHtml;
      }

      // Extract markdown from HTML
      const markdown = convertHtmlToMarkdown(directHtml);
      if (markdown.length >= 200 && !isGarbageContent(markdown).garbage) {
        cacheDoc(cacheKey, markdown, CACHE_TTLS.DOCS_PAGE);
        return markdown;
      }
    }

    // Path 2: Jina Reader (handles JS-rendered pages, but rate-limited)
    const jinaResult = await fetchViaJina(url);
    if (jinaResult && jinaResult.length >= 100) {
      cacheDoc(cacheKey, jinaResult, CACHE_TTLS.DOCS_PAGE);
      return jinaResult;
    }

    return null;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Race direct HTML extraction against Jina Reader — first good result wins.
 * Use this when you need fast, reliable content and the URL might or might not need JS rendering.
 */
export async function fetchAsMarkdownRace(url: string): Promise<string | null> {
  const cacheKey = `md:${url}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    try {
      const docsifyRaw = docsifyToRaw(url);
      const result = await Promise.any([
        // Path 0: Docsify hash-route → raw markdown. For hash URLs the direct
        // path below would fetch the homepage shell (fragment never sent), so
        // when this is a docsify URL the raw .md replaces the direct attempt.
        (async () => {
          if (!docsifyRaw) throw new Error("not a docsify URL");
          const md = await tryFetch(docsifyRaw, 0);
          if (md && md.length >= 200 && !isGarbageContent(md).garbage) return md;
          throw new Error("docsify raw failed");
        })(),
        // Path 1: Direct fetch + HTML extraction (usually faster)
        (async () => {
          if (docsifyRaw) throw new Error("hash-routed URL — direct fetch returns homepage");
          const html = await tryFetch(url, 0);
          if (!html) throw new Error("no content");
          const tagDensity = (html.match(/<[a-z]/gi) ?? []).length / Math.max(html.length, 1);
          if (tagDensity < 0.005 && html.length > 100) {
            if (isGarbageContent(html).garbage) throw new Error("garbage content");
            return html;
          }
          const md = convertHtmlToMarkdown(html);
          if (md.length >= 200) {
            if (isGarbageContent(md).garbage) throw new Error("garbage content after extraction");
            return md;
          }
          throw new Error("extraction too short");
        })(),
        // Path 2: Jina Reader (handles JS-rendered sites)
        (async () => {
          const md = await fetchViaJina(url);
          if (md && md.length >= 100) return md;
          throw new Error("jina failed");
        })(),
      ]);

      cacheDoc(cacheKey, result, CACHE_TTLS.DOCS_PAGE);
      return result;
    } catch {
      return null;
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
