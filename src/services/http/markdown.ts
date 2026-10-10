import { CACHE_TTLS } from "../../constants.js";
import { convertHtmlToMarkdown, looksLikeHtml, visibleTextLength } from "../../utils/html-to-md.js";
import { cacheDoc } from "./request.js";
import { tryFetch, tryFetchPage, type FetchedText } from "./try-fetch.js";
import { fetchViaJina } from "./jina.js";
import { readThrough } from "./swr.js";
import { isGarbageContent } from "../content-guards.js";

/**
 * In the race, Jina starts once the direct path came back empty or after this
 * long. Firing it with every direct fetch spent the anonymous Jina quota on
 * pages the direct path already had, and the resulting 429s stalled later calls.
 */
export const JINA_HEDGE_MS = 1500;

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

/** A direct conversion; `thin` ones lost the content and only answer when Jina has nothing either. */
export type Direct = { md: string; thin: boolean } | null;

function convertDirect(page: FetchedText): Direct {
  if (!looksLikeHtml(page.text, page.contentType)) {
    return page.text.length > 100 && !isGarbageContent(page.text).garbage ? { md: page.text, thin: false } : null;
  }
  const md = convertHtmlToMarkdown(page.text);
  if (md.length < 200 || isGarbageContent(md).garbage) return null;
  return { md, thin: md.length * 20 < visibleTextLength(page.text) };
}

/**
 * Usable markdown from a direct fetch: the server's own markdown or plain text
 * as-is, HTML converted. Null when neither passes the content gates. A
 * conversion under 1/20 of the page's visible text lost the content (a lead
 * paragraph where the page has a whole guide): null hands the page to Jina.
 */
export function directToMarkdown(page: FetchedText): string | null {
  const direct = convertDirect(page);
  return direct && !direct.thin ? direct.md : null;
}

/**
 * The fast, Jina-free path. Docsify hash routes read the raw .md instead: for
 * them a direct fetch would return the homepage shell for EVERY page.
 */
export async function fetchDirect(url: string, retries: number): Promise<Direct> {
  const docsifyRaw = docsifyToRaw(url);
  if (docsifyRaw) {
    const md = await tryFetch(docsifyRaw, retries);
    return md && md.length >= 200 && !isGarbageContent(md).garbage ? { md, thin: false } : null;
  }
  const page = await tryFetchPage(url, retries);
  return page ? convertDirect(page) : null;
}

/** The usable direct markdown, null for a thin one. */
export const fullDirect = (direct: Direct): string | null => (direct && !direct.thin ? direct.md : null);

/** Jina Reader renders JS-only pages, but is rate-limited. */
async function fetchJina(url: string): Promise<string | null> {
  const md = await fetchViaJina(url);
  return md && md.length >= 100 ? md : null;
}

/** True once `direct` produced content, false when it came back empty or `ms` passed first. */
export function hedge(direct: Promise<string | null>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void direct.then((md) => {
      clearTimeout(timer);
      resolve(md !== null);
    });
  });
}

function firstContent(candidates: Array<Promise<string | null>>): Promise<string | null> {
  return Promise.any(candidates.map((p) => p.then((md) => md ?? Promise.reject(new Error("no content"))))).catch(() => null);
}

/** Cached `md:` entry (stale ones revalidate in the background), else `fetchFresh`, single-flight per URL. */
function cachedMarkdown(url: string, fetchFresh: () => Promise<string | null>): Promise<string | null> {
  const key = `md:${url}`;
  return readThrough(key, fetchFresh, (md) => cacheDoc(key, md, CACHE_TTLS.DOCS_PAGE));
}

/**
 * Fetch a URL as markdown, trying direct HTML extraction first (fast, no Jina dependency),
 * then falling back to Jina Reader for JS-rendered pages.
 * This is the core reliability improvement — provides two independent paths to content.
 */
export async function fetchAsMarkdown(url: string): Promise<string | null> {
  return cachedMarkdown(url, async () => {
    const direct = await fetchDirect(url, 1);
    return fullDirect(direct) ?? (await fetchJina(url)) ?? direct?.md ?? null;
  });
}

/**
 * Direct extraction first, Jina hedged behind it — first good result wins.
 * Use this when you need fast, reliable content and the URL might or might not need JS rendering.
 */
export async function fetchAsMarkdownRace(url: string): Promise<string | null> {
  return cachedMarkdown(url, () => {
    const direct = fetchDirect(url, 0).catch((): Direct => null);
    const full = direct.then(fullDirect);
    const jina = hedge(full, JINA_HEDGE_MS).then((directWon) => (directWon ? null : fetchJina(url)));
    return firstContent([full, jina]).then(async (md) => md ?? (await direct)?.md ?? null);
  });
}
