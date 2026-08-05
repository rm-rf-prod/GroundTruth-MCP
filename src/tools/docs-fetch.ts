import type { FetchResult, LibraryEntry } from "../types.js";
import { fetchDocs, fetchGitHubContent, fetchAsMarkdownRace } from "../services/fetcher.js";
import { deepFetchForTopic, splitTopics } from "../services/deep-fetch.js";
import { withNotice } from "../utils/guard.js";
import { isValidPackageName, type DocsTarget } from "./docs-resolve.js";

/** README at a version tag, when the library has a GitHub repo. */
async function fetchTaggedReadme(githubUrl: string, version: string): Promise<FetchResult | undefined> {
  const ghMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!ghMatch) return undefined;
  const tagRef = version.startsWith("v") ? version : `v${version}`;
  const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${tagRef}/README.md`;
  const raw = await fetchAsMarkdownRace(rawUrl).catch(() => null);
  return raw && raw.length > 200 ? { content: raw, url: rawUrl, sourceType: "github-readme" } : undefined;
}

/** Versioned npm package page, used when no tagged README exists. */
async function fetchVersionedNpm(
  entry: LibraryEntry | null,
  libraryId: string,
  version: string,
): Promise<FetchResult | undefined> {
  const pkgName = entry?.id?.replace(/^[^/]+\//, "") ?? libraryId.replace(/^npm:/, "");
  if (!isValidPackageName(pkgName) || !/^[\w.-]+$/.test(version)) return undefined;
  const versionedUrl = `https://www.npmjs.com/package/${pkgName}/v/${version}`;
  const raw = await fetchAsMarkdownRace(versionedUrl).catch(() => null);
  return raw && raw.length > 200 ? { content: raw, url: versionedUrl, sourceType: "npm" } : undefined;
}

function buildFailureText(target: DocsTarget, entry: LibraryEntry | null, topic: string): string {
  const tried = [target.docsUrl, target.llmsTxtUrl, target.llmsFullTxtUrl, target.githubUrl]
    .filter((u): u is string => typeof u === "string");

  const suggestions: string[] = [];
  if (!entry) suggestions.push("- Run gt_resolve_library to verify the library ID is correct");
  suggestions.push("- Try gt_search with your question as a freeform query");
  if (!target.githubUrl) suggestions.push("- Provide a direct docs URL as the libraryId (e.g. 'https://docs.example.com')");
  if (topic) suggestions.push("- Try without a topic filter to get the main docs page");

  // withNotice on the failure path too: this is the response most likely to be
  // relayed verbatim, so it must carry the same provenance/licence/update notice.
  return withNotice([
    `Could not fetch documentation for "${target.displayName}".`,
    "",
    "**Sources attempted:**",
    ...tried.map((u) => `- ${u}`),
    "",
    "**What to try next:**",
    ...suggestions,
  ].join("\n"));
}

/**
 * Fetch documentation for a resolved target. Returns a message string instead of
 * a result when every source failed, so the caller can surface it verbatim.
 */
export async function fetchDocsContent(
  target: DocsTarget,
  entry: LibraryEntry | null,
  libraryId: string,
  topic: string,
  version: string | undefined,
): Promise<FetchResult | string> {
  let fetchResult: FetchResult | undefined;

  // Version-specific fetch: try GitHub tag README first, then npm versioned page
  if (version && target.githubUrl) fetchResult = await fetchTaggedReadme(target.githubUrl, version);
  if (version && !fetchResult) fetchResult = await fetchVersionedNpm(entry, libraryId, version);

  try {
    if (!fetchResult) {
      fetchResult = await fetchDocs(target.docsUrl, target.llmsTxtUrl, target.llmsFullTxtUrl, topic || undefined);
    }
  } catch {
    if (target.githubUrl) {
      // If a version was requested, prefer the version-tagged README so the
      // fallback does not silently serve HEAD content for a pinned request.
      if (version && !fetchResult) fetchResult = await fetchTaggedReadme(target.githubUrl, version);
      if (!fetchResult) fetchResult = (await fetchGitHubContent(target.githubUrl)) ?? undefined;
    }
    if (!fetchResult) return buildFailureText(target, entry, topic);
  }

  if (!fetchResult) {
    return withNotice([
      `No documentation found for "${target.displayName}".`,
      "",
      "**What to try next:**",
      "- Run gt_resolve_library to check if the library exists under a different name",
      "- Try gt_search with a freeform query about what you need",
      "- Provide a direct docs URL as the libraryId",
    ].join("\n"));
  }

  return fetchResult;
}

/**
 * Resolve a topic against the fetched document. Multi-part topics ("routing and
 * caching") are deep-fetched separately and merged, deduped by URL so the base
 * document is never concatenated two or three times.
 */
export async function applyTopic(
  fetchResult: FetchResult,
  topic: string,
  docsUrl: string,
  urlPatterns: string[] | undefined,
): Promise<FetchResult> {
  const subtopics = splitTopics(topic);
  if (subtopics.length <= 1) {
    return deepFetchForTopic(fetchResult, topic, docsUrl, urlPatterns);
  }

  const baseCopy: FetchResult = {
    content: fetchResult.content,
    url: fetchResult.url,
    sourceType: fetchResult.sourceType,
  };
  const results = await Promise.all(
    subtopics.map((st) => deepFetchForTopic(baseCopy, st, docsUrl, urlPatterns)),
  );
  const seenUrls = new Set<string>();
  const combined = results
    .filter((r) => (seenUrls.has(r.url) ? false : (seenUrls.add(r.url), true)))
    .filter((r) => r.content.length > 200)
    .map((r) => `## ${r.url}\n\n${r.content}`)
    .join("\n\n---\n\n");

  if (combined.length > 300) {
    return { content: combined, url: results[0]?.url ?? docsUrl, sourceType: "deep-fetch" };
  }
  return fetchResult;
}
