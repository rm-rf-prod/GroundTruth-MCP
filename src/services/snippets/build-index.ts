import type { FetchResult, Snippet, SnippetIndex } from "../../types.js";
import { fetchDocs, fetchGitHubContent, fetchAsMarkdownRace, isIndexContent, rankIndexLinks, fetchSitemapUrls } from "../fetcher.js";
import { extractInternalLinks, rankLinksForTopic, fetchMultiplePages } from "../deep-fetch.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { extractSnippets, rankSnippets } from "../../utils/snippet-extract.js";

/** Snippets that answer the topic; all snippets when no topic given. */
function topicMatches(snippets: Snippet[], topic: string): number {
  return topic.trim().length > 0 ? rankSnippets(snippets, topic, undefined, 3).length : snippets.length;
}

export async function buildIndex(
  library: string,
  version: string | undefined,
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  githubUrl: string | undefined,
  topic = "",
): Promise<SnippetIndex | null> {
  let fetchResult: FetchResult | undefined;

  if (version && githubUrl) {
    const ghMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (ghMatch?.[1]) {
      const tagRef = version.startsWith("v") ? version : `v${version}`;
      const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${tagRef}/README.md`;
      const raw = await fetchAsMarkdownRace(rawUrl).catch(() => null);
      if (raw && raw.length > 200) {
        fetchResult = { content: raw, url: rawUrl, sourceType: "github-readme" };
      }
    }
  }

  if (!fetchResult) {
    try {
      fetchResult = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
    } catch {
      if (githubUrl) {
        const gh = await fetchGitHubContent(githubUrl);
        if (gh) fetchResult = gh;
      }
    }
  }

  if (!fetchResult) return null;

  let snippets = extractSnippets(sanitizeContent(fetchResult.content), library, fetchResult.url, version);
  let sourceUrl = fetchResult.url;

  // Reliability fallback: landing-page-only docs (e.g. expressjs.com) carry no
  // fenced code, so the index comes back empty. The GitHub README almost always
  // has usage examples — retry there before giving up, unless it was already the
  // source. This is why gt_snippets("expressjs/express") returned "No snippets".
  if (snippets.length === 0 && githubUrl && fetchResult.sourceType !== "github-readme") {
    const gh = await fetchGitHubContent(githubUrl).catch(() => null);
    if (gh?.content) {
      const ghSnippets = extractSnippets(sanitizeContent(gh.content), library, gh.url, version);
      if (ghSnippets.length > 0) {
        snippets = ghSnippets;
        sourceUrl = gh.url;
      }
    }
  }

  // Framework docs are often a link index (llms.txt/TOC) with zero fenced
  // code — the snippets live one level down. Traverse the most topic-relevant
  // child pages and index those too. This is why gt_snippets("vercel/next.js")
  // used to return "No snippets indexed". Topic-aware: a landing page full of
  // install commands must not satisfy a "shared value" query.
  if (topicMatches(snippets, topic) < 3) {
    const seedTopic = topic.trim().length > 0 ? topic : "example usage getting started";
    const fromIndex = isIndexContent(fetchResult.content)
      ? rankIndexLinks(fetchResult.content, seedTopic, fetchResult.url || docsUrl)
      : [];
    const fromLinks = rankLinksForTopic(
      extractInternalLinks(fetchResult.content, docsUrl),
      seedTopic,
    ).map((l) => l.url);
    const candidates = [...new Set([...fromIndex, ...fromLinks])].slice(0, 4);
    if (candidates.length > 0) {
      const pages = await fetchMultiplePages(candidates, 4);
      const seen = new Set(snippets.map((s) => s.id));
      const collect = (content: string, url: string): void => {
        for (const s of extractSnippets(sanitizeContent(content), library, url, version)) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            snippets.push(s);
          }
        }
      };
      for (const page of pages) collect(page.content, page.url);

      // Hop 2: topic landing pages (e.g. supabase guides/auth.md) are often
      // code-free overviews linking to the concrete sub-guides.
      if (topicMatches(snippets, topic) < 3 && pages.length > 0) {
        const secondary = [
          ...new Set(
            pages.flatMap((p) =>
              rankLinksForTopic(extractInternalLinks(p.content, p.url), seedTopic)
                .slice(0, 2)
                .map((l) => l.url),
            ),
          ),
        ].filter((u) => !candidates.includes(u));
        for (const page of await fetchMultiplePages(secondary.slice(0, 3), 3)) {
          collect(page.content, page.url);
        }
      }
    }

    // Hop 3: JS-rendered sidebars (Docusaurus etc.) hide most doc links from
    // converted pages — the sitemap lists every page.
    if (topicMatches(snippets, topic) < 3) {
      const sitemapUrls = await fetchSitemapUrls(docsUrl);
      const ranked = rankLinksForTopic(
        sitemapUrls.map((url) => ({ url, text: url })),
        seedTopic,
      ).slice(0, 3);
      if (ranked.length > 0) {
        const seen = new Set(snippets.map((s) => s.id));
        for (const page of await fetchMultiplePages(ranked.map((l) => l.url), 3)) {
          for (const s of extractSnippets(sanitizeContent(page.content), library, page.url, version)) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              snippets.push(s);
            }
          }
        }
      }
    }
  }

  return {
    library,
    version: version ?? null,
    sourceUrl,
    snippets,
    builtAt: new Date().toISOString(),
  };
}
