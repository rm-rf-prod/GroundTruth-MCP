import { fuzzySearch, lookupById } from "../../sources/registry.js";
import { fetchDocs, fetchDevDocs } from "../fetcher.js";
import { deepFetchForTopic } from "../deep-fetch.js";
import { extractRelevantContent } from "../../utils/extract.js";
import { checkEvidence } from "../../utils/evidence.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { findTopicUrls } from "./topic-match.js";
import { buildDirectDocsUrls, buildJinaFallbackUrls } from "./candidates.js";
import { searchMDN, searchDDGInstant } from "./engines.js";
import { fetchTopicContent, addWebSearchSources, type SearchSource } from "./fetch-topic.js";

/** Push every fulfilled candidate not already collected, stopping at `limit` sources. */
function absorb(
  settled: Array<PromiseSettledResult<SearchSource>>,
  results: SearchSource[],
  limit: number,
): void {
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    if (results.some((existing) => existing.url === r.value.url)) continue;
    results.push(r.value);
    if (results.length >= limit) break;
  }
}

/** Fetch a batch of candidate URLs in parallel, keeping only pages with real content. */
function fetchAll(
  candidates: Array<{ url: string; source: string }>,
  query: string,
  tokens: number,
): Promise<Array<PromiseSettledResult<SearchSource>>> {
  return Promise.allSettled(
    candidates.map(async ({ url, source }) => {
      const content = await fetchTopicContent(url, query, tokens);
      if (content.length > 200) return { source, url, content };
      throw new Error("no content");
    }),
  );
}

/**
 * Sourcing pipeline for gt_search: registry docs, then curated topic URLs, then
 * progressively broader fallbacks. Every stage is gated on real extracted content,
 * so a weak early hit never blocks a better later one.
 */
export async function collectSearchSources(
  query: string,
  tokens: number,
): Promise<{ results: SearchSource[]; webSearched: boolean }> {
  const results: SearchSource[] = [];

  // 1. Check registry (library-based query)
  for (const match of fuzzySearch(query, 3)) {
    const entry = lookupById(match.id);
    if (!entry) continue;
    try {
      let fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl);
      // llms.txt is usually an index of links — traverse it to the actual
      // topic pages instead of extracting from the link list itself.
      fetchResult = await deepFetchForTopic(fetchResult, query, entry.docsUrl, entry.urlPatterns);
      const safe = sanitizeContent(fetchResult.content);
      const { text } = extractRelevantContent(safe, query, Math.floor(tokens / 2));
      // Evidence gate, same bar the topic-map stage already applies. This
      // was the one sourcing stage with no check: a loose fuzzy match could
      // take the first result slot with a page that never covers the query,
      // and the `break` stopped every later stage from replacing it.
      if (text.length > 200 && checkEvidence(text, query).ok) {
        results.push({ source: entry.name, url: fetchResult.url, content: text });
        break; // one registry match is enough for freeform search
      }
    } catch {
      // try next
    }
  }

  // 2. Topic map — curated official docs URLs for non-library topics
  const topicMatches = findTopicUrls(query);
  for (const topic of topicMatches) {
    // Cap the topic-map contribution and check BEFORE fetching: two high-quality
    // sources beat three where the third is a weak co-match. Combined with the
    // specificity gate in findTopicUrls this stops nav-only pages being fetched.
    if (results.length >= 2) break;
    for (const url of topic.urls.slice(0, 2)) {
      const content = await fetchTopicContent(url, query, Math.floor(tokens / (topicMatches.length + 1)));
      if (content.length > 200) {
        results.push({ source: topic.name, url, content });
        break;
      }
    }
  }

  // 3. Try direct URL construction for common documentation sites.
  // Runs whenever we have FEWER THAN TWO sources — one weak hit must not
  // stop sourcing (that is exactly how thin single-page answers happen).
  if (results.length < 2) {
    const directUrls = buildDirectDocsUrls(query);
    if (directUrls.length > 0) {
      absorb(
        await fetchAll(
          directUrls.slice(0, 6).map((c) => ({ url: c.url, source: c.name })),
          query,
          Math.floor(tokens / 2),
        ),
        results,
        2,
      );
    }
  }

  // 4. MDN JSON API search — free, structured, no scraping needed
  if (results.length < 2) {
    const mdnResults = await searchMDN(query);
    if (mdnResults.length > 0) {
      absorb(
        await fetchAll(
          mdnResults.slice(0, 3).map((m) => ({ url: m.url, source: `MDN: ${m.title}` })),
          query,
          Math.floor(tokens / 2),
        ),
        results,
        2,
      );
    }
  }

  // 4b. DuckDuckGo Instant Answer API — free structured JSON, no HTML scraping
  if (results.length === 0) {
    const ddgUrls = await searchDDGInstant(query);
    if (ddgUrls.length > 0) {
      absorb(
        await fetchAll(
          ddgUrls.slice(0, 3).map((url) => {
            let source: string;
            try { source = new URL(url).hostname; } catch { source = url; }
            return { url, source };
          }),
          query,
          Math.floor(tokens / 2),
        ),
        results,
        2,
      );
    }
  }

  // 5. If still no results, try web search for authoritative URLs then fetch via Jina
  let webSearched = false;
  if (results.length === 0) {
    webSearched = true;
    await addWebSearchSources(query, results, Math.floor(tokens / 2), 3, 2);
  }

  // 6. Fallback — try DevDocs (pre-parsed docs for 200+ technologies)
  if (results.length === 0) {
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const techSlug = queryWords[0] ?? query.split(" ")[0] ?? "";
    if (techSlug) {
      const devDocsContent = await fetchDevDocs(techSlug, query);
      if (devDocsContent && devDocsContent.length > 200) {
        const safe = sanitizeContent(devDocsContent);
        const { text } = extractRelevantContent(safe, query, tokens);
        if (text.length > 200) {
          results.push({
            source: `DevDocs (${techSlug})`,
            url: `https://devdocs.io/${techSlug}/`,
            content: text,
          });
        }
      }
    }
  }

  // 7. Fallback — try Jina Reader directly on the query as a URL-like topic
  if (results.length === 0) {
    for (const candidate of buildJinaFallbackUrls(query).slice(0, 2)) {
      const content = await fetchTopicContent(candidate.url, query, tokens);
      if (content.length > 200) {
        results.push({
          source: `${candidate.name} (search results — weak evidence, follow links)`,
          url: candidate.url,
          content,
        });
        break;
      }
    }
  }

  // 8. Fallback — try fetching MDN search
  if (results.length === 0) {
    const mdnSearch = `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`;
    const content = await fetchTopicContent(mdnSearch, query, tokens);
    if (content.length > 200) {
      results.push({ source: "MDN search results (weak evidence — follow links)", url: mdnSearch, content });
    }
  }

  return { results, webSearched };
}
