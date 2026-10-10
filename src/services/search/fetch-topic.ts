import { fetchAsMarkdownRace, isErrorPage, hashContent } from "../fetcher.js";
import { extractRelevantContent, substantiveTokens } from "../../utils/extract.js";
import { checkEvidence } from "../../utils/evidence.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { docCache } from "../cache.js";
import { CACHE_TTLS } from "../../constants.js";
import { webSearch } from "./engines.js";
import { settleWithGrace, PAGE_GRACE_MS } from "../deep-fetch-pages.js";

export interface SearchSource {
  source: string;
  url: string;
  content: string;
}

export async function fetchTopicContent(
  url: string,
  query: string,
  tokens: number,
  minRatio = 0,
): Promise<string> {
  // Hash the FULL query — a 50-char prefix let distinct long queries silently
  // share cached BM25-extracted content.
  const cacheKey = `search:${url}:${hashContent(query)}`;
  const cached = docCache.get(cacheKey);
  let text: string;
  if (typeof cached === "string") {
    text = cached;
  } else {
    // Use fetchAsMarkdownRace: tries direct HTML extraction first, Jina as fallback
    const raw = await fetchAsMarkdownRace(url);
    if (!raw || raw.length < 200 || isErrorPage(raw)) return "";
    const safe = sanitizeContent(raw);
    text = extractRelevantContent(safe, query, tokens).text;
    // Evidence gate: pages whose extracted text never mentions a single query
    // term (soft-404s, search-results shells, off-topic landing pages) are
    // dropped instead of being served as answers. Only verified text is cached.
    // Specific queries (3+ substantive tokens) demand the full coverage bar —
    // a "performance" match alone must not let a Web-Vitals page answer a
    // Postgres row-level-security question.
    const check = checkEvidence(text, query);
    if (substantiveTokens(query).length >= 3 ? !check.ok : check.matchRatio === 0) return "";
    docCache.set(cacheKey, text, CACHE_TTLS.SEARCH_RESULT);
  }
  // Callers raise the bar for secondary sources: MDN's aria-level page matched
  // only "row level" of "postgres row level security" and was 32% of the answer.
  if (minRatio > 0 && substantiveTokens(query).length >= 3 && checkEvidence(text, query).matchRatio < minRatio) {
    return "";
  }
  return text;
}

/** Push every candidate not already collected, stopping at `limit` sources. */
export function absorb(fetched: SearchSource[], results: SearchSource[], limit: number): void {
  for (const source of fetched) {
    if (results.some((existing) => existing.url === source.url)) continue;
    results.push(source);
    if (results.length >= limit) break;
  }
}

/**
 * Fetch a batch of candidate URLs in parallel, keeping only pages with real
 * content. Stops waiting PAGE_GRACE_MS after the first page lands, so one slow
 * Jina render cannot hold back pages that are already in.
 */
export function fetchAll(
  candidates: Array<{ url: string; source: string }>,
  query: string,
  tokens: number,
  minRatio = 0,
): Promise<SearchSource[]> {
  return settleWithGrace(
    candidates.map(async ({ url, source }) => {
      const content = await fetchTopicContent(url, query, tokens, minRatio);
      if (content.length > 200) return { source, url, content };
      throw new Error("no content");
    }),
    PAGE_GRACE_MS,
  );
}

/**
 * Web-search fallback shared by step 5 (no sources yet) and the evidence-driven
 * escalation (sources exist but combined coverage is weak): search, skip URLs
 * already collected, fetch candidates in parallel, and append every page with
 * real content until maxResults is reached. Like fetchAll, it stops waiting
 * PAGE_GRACE_MS after the first page lands.
 */
export async function addWebSearchSources(
  query: string,
  results: SearchSource[],
  perSourceTokens: number,
  maxUrls: number,
  maxResults = Number.POSITIVE_INFINITY,
): Promise<void> {
  const searchUrls = await webSearch(query);
  const known = new Set(results.map((r) => r.url));
  const fetched = await settleWithGrace(
    searchUrls.filter((u) => !known.has(u)).slice(0, maxUrls).map(async (url) => {
      const content = await fetchTopicContent(url, query, perSourceTokens);
      if (content.length > 200) {
        let source: string;
        try { source = new URL(url).hostname; } catch { source = url; }
        return { source, url, content };
      }
      throw new Error("no content");
    }),
    PAGE_GRACE_MS,
  );
  for (const source of fetched) {
    if (results.length < maxResults) results.push(source);
  }
}
