import { fetchWithTimeout, hashContent } from "../fetcher.js";
import { CACHE_TTLS } from "../../constants.js";
import { extractDDGUrls, extractUrlsFromHtml, scoreDocUrl } from "./url-rank.js";
import { remembered } from "./remember.js";
import { discardBody } from "../http/body.js";

/** Repeats of a query reuse the URL lists: every MDN API and search-engine round trip was re-run. */
export const searchMDN = (query: string): Promise<Array<{ url: string; title: string }>> =>
  remembered(`mdn-search:${hashContent(query)}`, CACHE_TTLS.WEB_SEARCH, () => mdnSearch(query));
export const webSearch = (query: string): Promise<string[]> =>
  remembered(`web-search:${hashContent(query)}`, CACHE_TTLS.WEB_SEARCH, () => multiEngineSearch(query));

/**
 * Search MDN Web Docs via their free JSON API (no auth, no rate limit issues).
 * Returns doc page URLs sorted by relevance. Ideal for web standards, CSS, HTML, JS, HTTP.
 */
async function mdnSearch(query: string): Promise<Array<{ url: string; title: string }>> {
  try {
    const res = await fetchWithTimeout(
      `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US&size=10`,
      8000,
    );
    if (!res.ok) {
      discardBody(res);
      return [];
    }
    const data = await res.json() as { documents?: Array<{ mdn_url?: string; title?: string; summary?: string }> };
    if (!Array.isArray(data?.documents)) return [];
    return data.documents
      .filter((d) => d.mdn_url && d.title)
      .map((d) => ({
        url: `https://developer.mozilla.org${d.mdn_url}`,
        title: d.title ?? "",
      }));
  } catch {
    return [];
  }
}
/**
 * DuckDuckGo Instant Answer API — returns structured results without HTML scraping.
 * Free, no auth required. Returns topic summary + related topics with URLs.
 * Falls back gracefully (returns empty array) when no instant answer exists.
 */
export async function searchDDGInstant(query: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      8000,
    );
    if (!res.ok) {
      discardBody(res);
      return [];
    }
    const data = await res.json() as {
      AbstractURL?: string;
      RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
      Results?: Array<{ FirstURL?: string }>;
    };
    const urls: string[] = [];
    if (data.AbstractURL) urls.push(data.AbstractURL);
    if (Array.isArray(data.Results)) {
      for (const r of data.Results.slice(0, 3)) {
        if (r.FirstURL) urls.push(r.FirstURL);
      }
    }
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics.slice(0, 3)) {
        if (t.FirstURL) urls.push(t.FirstURL);
      }
    }
    return urls;
  } catch {
    return [];
  }
}
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * SearXNG public instances with JSON API support.
 * Rotated with circuit breaker to handle instance downtime.
 * These are community-run — expect occasional failures.
 */
const SEARXNG_INSTANCES = [
  "https://paulgo.io",
  "https://priv.au",
  "https://opnxng.com",
  "https://baresearch.org",
];

async function searchSearXNG(query: string): Promise<string[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const res = await fetchWithTimeout(
        `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
        8000,
      );
      if (!res.ok) {
        discardBody(res);
        continue;
      }
      const data = await res.json() as { results?: Array<{ url?: string; title?: string }> };
      if (!Array.isArray(data?.results) || data.results.length === 0) continue;
      return data.results
        .filter((r): r is { url: string; title?: string } => typeof r.url === "string" && r.url.startsWith("http"))
        .map((r) => r.url)
        .slice(0, 8);
    } catch {
      continue;
    }
  }
  return [];
}

/** A search engine's HTML result page; null, with the body discarded, when it answered non-ok. */
async function fetchHtml(url: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, 10_000, { Accept: "text/html", "User-Agent": BROWSER_UA });
  if (res.ok) return res.text();
  discardBody(res);
  return null;
}

/**
 * Multi-engine web search with prioritized fallback chain.
 * 1. DuckDuckGo HTML (uddg= extraction — most reliable)
 * 2. DuckDuckGo Lite (simpler HTML, same extraction)
 * 3. SearXNG JSON API (structured, but public instances are flaky)
 * 4. Mojeek HTML (direct URLs, no redirect wrappers, smaller index)
 * 5. Legacy: extractUrlsFromHtml for any search engine HTML
 *
 * Bing and Brave are deliberately excluded:
 * - Bing returns Cloudflare PoW challenges for server-side requests
 * - Brave uses SvelteKit CSR — no results in SSR HTML
 */
async function multiEngineSearch(query: string): Promise<string[]> {
  const docsHint = "official docs documentation guide reference";
  const searchQuery = `${query} ${docsHint}`;
  const encoded = encodeURIComponent(searchQuery);

  // 1. DuckDuckGo HTML — uddg= parameter extraction (stable 4+ years)
  try {
    const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encoded}`);
    if (html !== null) {
      const urls = extractDDGUrls(html);
      if (urls.length > 0) {
        return urls
          .map((url) => ({ url, score: scoreDocUrl(url, query) }))
          .sort((a, b) => b.score - a.score)
          .map((r) => r.url);
      }
      // Fallback to generic extraction if uddg pattern missing
      const legacyUrls = extractUrlsFromHtml(html);
      if (legacyUrls.length > 0) return legacyUrls;
    }
  } catch { /* DDG HTML failed */ }

  // 2. DuckDuckGo Lite — even simpler HTML, same uddg= pattern
  try {
    const html = await fetchHtml(`https://lite.duckduckgo.com/lite/?q=${encoded}`);
    if (html !== null) {
      const urls = extractDDGUrls(html);
      if (urls.length > 0) {
        return urls
          .map((url) => ({ url, score: scoreDocUrl(url, query) }))
          .sort((a, b) => b.score - a.score)
          .map((r) => r.url);
      }
    }
  } catch { /* DDG Lite failed */ }

  // 3. SearXNG JSON API — structured results, rotate across public instances
  try {
    const searxUrls = await searchSearXNG(searchQuery);
    if (searxUrls.length > 0) {
      return searxUrls
        .map((url) => ({ url, score: scoreDocUrl(url, query) }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.url);
    }
  } catch { /* SearXNG failed */ }

  // 4. Mojeek — independent search engine, direct URLs (no redirect wrappers)
  try {
    const html = await fetchHtml(`https://www.mojeek.com/search?q=${encoded}`);
    if (html !== null) {
      // Mojeek uses direct hrefs — no redirect wrapping
      const urls = extractUrlsFromHtml(html);
      if (urls.length > 0) {
        return urls
          .map((url) => ({ url, score: scoreDocUrl(url, query) }))
          .sort((a, b) => b.score - a.score)
          .map((r) => r.url);
      }
    }
  } catch { /* Mojeek failed */ }

  return [];
}
