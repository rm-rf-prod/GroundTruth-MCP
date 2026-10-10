import { lookupById } from "../../sources/registry.js";
import { fetchDocs, fetchDevDocs } from "../fetcher.js";
import { deepFetchForTopic } from "../deep-fetch.js";
import { extractRelevantContent } from "../../utils/extract.js";
import { checkEvidence } from "../../utils/evidence.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { findTopicUrls } from "./topic-match.js";
import { buildDirectDocsUrls, buildJinaFallbackUrls } from "./candidates.js";
import { searchMDN, searchDDGInstant } from "./engines.js";
import { fetchTopicContent, addWebSearchSources, absorb, fetchAll, type SearchSource } from "./fetch-topic.js";
import { registryMatches } from "./registry-match.js";

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
  for (const { id, topic } of registryMatches(query)) {
    const entry = lookupById(id);
    if (!entry) continue;
    try {
      let fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl, topic);
      // llms.txt is usually an index of links — traverse it to the actual
      // topic pages instead of extracting from the link list itself.
      fetchResult = await deepFetchForTopic(fetchResult, topic, entry.docsUrl, entry.urlPatterns);
      const safe = sanitizeContent(fetchResult.content);
      const { text } = extractRelevantContent(safe, topic, Math.floor(tokens / 2));
      // Evidence gate, same bar the topic-map stage already applies. This
      // was the one sourcing stage with no check: a loose fuzzy match could
      // take the first result slot with a page that never covers the query,
      // and the `break` stopped every later stage from replacing it.
      if (text.length > 200 && checkEvidence(text, topic).ok) {
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
      if (results.some((r) => r.url === url)) break; // the registry stage already has it
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
          // MDN search is fuzzy: as a second source it must cover most of the query.
          results.length > 0 ? 0.75 : 0,
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
