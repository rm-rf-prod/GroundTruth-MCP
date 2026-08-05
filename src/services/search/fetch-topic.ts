import { fetchAsMarkdownRace, isErrorPage, hashContent } from "../fetcher.js";
import { extractRelevantContent, substantiveTokens } from "../../utils/extract.js";
import { checkEvidence } from "../../utils/evidence.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { docCache } from "../cache.js";
import { CACHE_TTLS } from "../../constants.js";
import { webSearch } from "./engines.js";

export interface SearchSource {
  source: string;
  url: string;
  content: string;
}

export async function fetchTopicContent(url: string, query: string, tokens: number): Promise<string> {
  // Hash the FULL query — a 50-char prefix let distinct long queries silently
  // share cached BM25-extracted content.
  const cacheKey = `search:${url}:${hashContent(query)}`;
  const cached = docCache.get(cacheKey);
  if (typeof cached === "string") return cached;

  // Use fetchAsMarkdownRace: tries direct HTML extraction first, Jina as fallback
  const raw = await fetchAsMarkdownRace(url);
  if (!raw || raw.length < 200 || isErrorPage(raw)) return "";
  const safe = sanitizeContent(raw);
  const { text } = extractRelevantContent(safe, query, tokens);
  // Evidence gate: pages whose extracted text never mentions a single query
  // term (soft-404s, search-results shells, off-topic landing pages) are
  // dropped instead of being served as answers. Only verified text is cached.
  // Specific queries (3+ substantive tokens) demand the full coverage bar —
  // a "performance" match alone must not let a Web-Vitals page answer a
  // Postgres row-level-security question.
  const check = checkEvidence(text, query);
  if (substantiveTokens(query).length >= 3 ? !check.ok : check.matchRatio === 0) return "";
  docCache.set(cacheKey, text, CACHE_TTLS.SEARCH_RESULT);
  return text;
}

/**
 * Web-search fallback shared by step 5 (no sources yet) and the evidence-driven
 * escalation (sources exist but combined coverage is weak): search, skip URLs
 * already collected, fetch candidates in parallel, and append every page with
 * real content until maxResults is reached.
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
  const fetched = await Promise.allSettled(
    searchUrls.filter((u) => !known.has(u)).slice(0, maxUrls).map(async (url) => {
      const content = await fetchTopicContent(url, query, perSourceTokens);
      if (content.length > 200) {
        let source: string;
        try { source = new URL(url).hostname; } catch { source = url; }
        return { source, url, content };
      }
      throw new Error("no content");
    }),
  );
  for (const r of fetched) {
    if (r.status === "fulfilled" && results.length < maxResults) {
      results.push(r.value);
    }
  }
}
