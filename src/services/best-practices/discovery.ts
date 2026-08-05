import { fetchGitHubContent, fetchGitHubExamples, fetchAsMarkdownRace, fetchSitemapUrls, isIndexContent } from "../fetcher.js";
import { extractRelevantContent, tokenize } from "../../utils/extract.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import type { BestPracticesContent } from "./fetch.js";

const FALLBACK_TOPIC = "best practices patterns guide";

function originOf(docsUrl: string): string | null {
  try {
    return new URL(docsUrl).origin;
  } catch {
    return null;
  }
}

/** Best-practice URLs discovered from the site's sitemap, topic matches first. */
export async function sitemapCandidates(docsUrl: string, topic: string): Promise<string[]> {
  const sitemapUrls = await fetchSitemapUrls(docsUrl);
  if (sitemapUrls.length === 0) return [];
  const bpPatterns = /best.?practice|guide|pattern|getting.?started|performance|security|testing|deployment/i;
  const topicSlug = topic ? topic.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : "";
  const topicWords = topic ? tokenize(topic) : [];
  return sitemapUrls
    .filter((u) => bpPatterns.test(u) || (topicSlug && u.toLowerCase().includes(topicSlug)))
    // Topic-matching URLs first — a generic pattern hit (e.g. /docs/security)
    // must not outrank an actual topic page (e.g. /docs/app/guides/caching).
    .map((u) => ({ u, hits: topicWords.filter((w) => u.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.hits - a.hits)
    .map(({ u }) => u)
    .slice(0, 5);
}

/** Docs-scoped llms.txt variants many sites publish separately from the root one. */
export async function fetchDocsLlmsTxt(
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  topic: string,
  tokens: number,
): Promise<BestPracticesContent | null> {
  const origin = originOf(docsUrl);
  if (!origin) return null;
  const candidates = [
    `${docsUrl}/llms-full.txt`,
    `${docsUrl}/llms.txt`,
    `${origin}/docs/llms-full.txt`,
    `${origin}/docs/llms.txt`,
  ].filter((u) => u !== llmsTxtUrl && u !== llmsFullTxtUrl);

  const enrichedTopic = topic ? `${topic} ${FALLBACK_TOPIC}` : `${FALLBACK_TOPIC} tips`;
  for (const url of candidates) {
    const raw = await fetchAsMarkdownRace(url).catch(() => null);
    if (!raw || raw.length <= 500) continue;
    const { text, truncated } = extractRelevantContent(sanitizeContent(raw), enrichedTopic, tokens);
    // llms.txt is a directory of links — a link list is a pointer to the
    // answer, never the answer itself. Fall through to deep-fetch, which
    // traverses the index to the actual pages.
    if (text.length > 200 && !isIndexContent(text)) {
      return {
        text,
        sourceUrl: url,
        truncated,
        extraSources: [],
        sourceType: url.includes("llms-full") ? "llms-full-txt" : "llms-txt",
      };
    }
  }
  return null;
}

/** GitHub examples, then the repo's own guidance markdown. */
export async function fetchFromGitHub(githubUrl: string, topic: string, tokens: number): Promise<BestPracticesContent | null> {
  const examplesContent = await fetchGitHubExamples(githubUrl);
  if (examplesContent) {
    const { text, truncated } = extractRelevantContent(sanitizeContent(examplesContent), topic, tokens);
    return { text, sourceUrl: githubUrl, truncated, extraSources: [], sourceType: "github-readme" };
  }
  for (const path of ["CONTRIBUTING.md", "docs/patterns.md", "docs/best-practices.md"]) {
    const ghResult = await fetchGitHubContent(githubUrl, path);
    if (ghResult) {
      const { text, truncated } = extractRelevantContent(sanitizeContent(ghResult.content), topic, tokens);
      return { text, sourceUrl: ghResult.url, truncated, extraSources: [], sourceType: "github-readme" };
    }
  }
  return null;
}
