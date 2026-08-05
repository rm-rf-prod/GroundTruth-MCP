import { fetchDocs } from "../fetcher.js";
import { deepFetchForTopic } from "../deep-fetch.js";
import { extractRelevantContent, expandTopicTokens } from "../../utils/extract.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { joinDocPaths } from "../../utils/url-join.js";
import { BEST_PRACTICES_URLS, GENERIC_BP_SUFFIXES } from "../../sources/best-practice-urls.js";
import { raceUrls } from "./race.js";
import { sitemapCandidates, fetchDocsLlmsTxt, fetchFromGitHub } from "./discovery.js";

export interface BestPracticesContent {
  text: string;
  sourceUrl: string;
  truncated: boolean;
  extraSources: string[];
  sourceType: string;
}

type RaceHit = { content: string; url: string; extraUrls: string[] };

const FALLBACK_TOPIC = "best practices patterns guide";

function originOf(docsUrl: string): string | null {
  try {
    return new URL(docsUrl).origin;
  } catch {
    return null;
  }
}

/** Sanitize + BM25-extract a raced page into the tool's result shape. */
function asContent(hit: RaceHit, topic: string, tokens: number): BestPracticesContent {
  const { text, truncated } = extractRelevantContent(sanitizeContent(hit.content), topic || FALLBACK_TOPIC, tokens);
  return { text, sourceUrl: hit.url, truncated, extraSources: hit.extraUrls, sourceType: "direct" };
}

/**
 * Rank the curated + registry URLs against the topic. When NONE of them mention
 * a topic term those canonical pages are unlikely to be on-topic (e.g. tailwind
 * "v4 migration" -> utility-first/optimizing-for-production), so they are deferred:
 * the topic-slug / sitemap / deep-fetch paths run first and the curated pages become
 * a last resort. That never serves an off-topic page when a real one exists, and
 * never regresses to an empty result when no topic-specific page is found.
 */
function rankKnownUrls(knownUrls: string[], topic: string): { targets: string[]; deferred: boolean } {
  if (!topic) return { targets: knownUrls, deferred: false };
  // Keep short version tokens ("v4", "v3") that the >2-char filter would drop —
  // they are exactly the signal that distinguishes a migration/version page.
  const words = expandTopicTokens(
    topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => (/^v?\d+(?:\.\d+)*$/.test(w) ? w.length >= 1 : w.length > 2)),
  );
  const scored = knownUrls
    .map((u) => ({ url: u, score: words.filter((w) => u.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score);
  return {
    targets: scored.map((s) => s.url).filter((u, i, arr) => arr.indexOf(u) === i),
    deferred: (scored[0]?.score ?? 0) === 0,
  };
}

export async function fetchBestPracticesContent(
  libraryId: string,
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  githubUrl: string | undefined,
  topic: string,
  tokens: number,
  bestPracticesPaths?: string[],
): Promise<BestPracticesContent> {
  // joinDocPaths keeps the docs base segment ("supabase.com/docs" + "/guides"),
  // which plain origin-joining dropped — that produced a 404 for 46 entries.
  const registryUrls = bestPracticesPaths?.length ? joinDocPaths(docsUrl, bestPracticesPaths) : [];
  const knownUrls = [...(BEST_PRACTICES_URLS[libraryId] ?? []), ...registryUrls]
    .filter((u, i, arr) => arr.indexOf(u) === i);

  // 1. Race known best-practices URLs in parallel
  const { targets, deferred } = knownUrls.length > 0
    ? rankKnownUrls(knownUrls, topic)
    : { targets: [], deferred: false };
  if (targets.length > 0 && !deferred) {
    const hit = await raceUrls(targets.slice(0, 5), topic);
    if (hit) return asContent(hit, topic, tokens);
  }

  // 1b. Construct docs URLs from the topic slug. Safe only because the fetch layer
  // garbage-gates Jina results: a fabricated path that 404s fails cleanly instead
  // of short-circuiting the real discovery paths below with a rendered error page.
  const origin = originOf(docsUrl);
  if (topic && origin) {
    const slug = topic.toLowerCase().replace(/\s+/g, "/").replace(/[^a-z0-9/-]/g, "");
    const hit = await raceUrls([`${origin}/docs/guides/${slug}`, `${origin}/docs/${slug}`, `${docsUrl}/${slug}`], topic);
    if (hit) return asContent(hit, topic, tokens);
  }

  // 2. Generic best-practices paths in parallel
  if (origin) {
    const hit = await raceUrls(GENERIC_BP_SUFFIXES.map((suffix) => `${origin}${suffix}`), topic);
    if (hit) return asContent(hit, topic, tokens);
  }

  // 2c. Sitemap-based discovery
  const bpUrls = await sitemapCandidates(docsUrl, topic);
  if (bpUrls.length > 0) {
    const hit = await raceUrls(bpUrls, topic);
    if (hit) return asContent(hit, topic, tokens);
  }

  // 2d. Docs-scoped llms.txt / llms-full.txt
  const llmsHit = await fetchDocsLlmsTxt(docsUrl, llmsTxtUrl, llmsFullTxtUrl, topic, tokens);
  if (llmsHit) return llmsHit;

  // 3. Fall back to main docs with an enriched best-practices topic
  try {
    const enrichedTopic = topic ? `${topic} ${FALLBACK_TOPIC}` : `${FALLBACK_TOPIC} tips`;
    let result = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl, topic || undefined);
    result = await deepFetchForTopic(result, enrichedTopic, docsUrl, bestPracticesPaths);
    const { text, truncated } = extractRelevantContent(sanitizeContent(result.content), enrichedTopic, tokens);
    return { text, sourceUrl: result.url, truncated, extraSources: [], sourceType: result.sourceType };
  } catch {
    // ignore — GitHub and the deferred-known-URL retry remain
  }

  // 4. GitHub examples / guidance markdown
  if (githubUrl) {
    const ghHit = await fetchFromGitHub(githubUrl, topic, tokens);
    if (ghHit) return ghHit;
  }

  // Last resort: the topic matched no known best-practices URL and every
  // topic-specific source above failed — fall back to the canonical known pages
  // now rather than returning nothing.
  if (deferred && knownUrls.length > 0) {
    const hit = await raceUrls(knownUrls.slice(0, 5), topic);
    if (hit) return asContent(hit, topic, tokens);
  }

  return {
    text: `Could not find specific best practices for "${libraryId}". Try gt_get_docs with topic="best practices patterns".`,
    sourceUrl: docsUrl,
    truncated: false,
    extraSources: [],
    sourceType: "direct",
  };
}
