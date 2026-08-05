import { CACHE_TTLS } from "../constants.js";
import type { FetchResult } from "../types.js";
import { docCache, diskDocCache } from "./cache.js";
import { log } from "../utils/logger.js";
import { fetchWithTimeout, cacheDoc, githubAuthHeaders } from "./http/request.js";
import { tryFetch } from "./http/try-fetch.js";

/** Fetch GitHub README or a specific file from a repo */
export async function fetchGitHubContent(
  githubUrl: string,
  path = "README.md",
): Promise<FetchResult | null> {
  // Convert github.com/org/repo to raw.githubusercontent.com/org/repo/main/path
  const match = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repoPath = match[1]!;

  const cacheKey = `gh:${repoPath}:${path}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) {
    return { content: memCached, url: githubUrl, sourceType: "github-readme" };
  }

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return { content: diskCached, url: githubUrl, sourceType: "github-readme" };
  }

  for (const branch of ["main", "master"]) {
    const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${path}`;
    const content = await tryFetch(rawUrl, 1, githubAuthHeaders());
    if (content) {
      cacheDoc(cacheKey, content, CACHE_TTLS.GITHUB_README);
      return { content, url: rawUrl, sourceType: "github-readme" };
    }
  }

  // Fallback: GitHub REST API. Works unauthenticated (60 req/hr); GT_GITHUB_TOKEN
  // raises the limit to 5000/hr. Previously gated entirely behind the token, which
  // disabled the fallback for the common no-token case.
  const token = process.env.GT_GITHUB_TOKEN;
  const apiHeaders: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
  if (token) apiHeaders.Authorization = `Bearer ${token}`;
  for (const branch of ["main", "master"]) {
    const apiUrl = `https://api.github.com/repos/${repoPath}/contents/${path}?ref=${branch}`;
    const content = await tryFetch(apiUrl, 0, apiHeaders);
    if (content) {
      cacheDoc(cacheKey, content, CACHE_TTLS.GITHUB_README);
      return { content, url: apiUrl, sourceType: "github-readme" };
    }
  }

  return null;
}

/** Fetch latest GitHub release notes (tag name + body) */
export async function fetchGitHubReleases(githubUrl: string): Promise<string | null> {
  const match = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repoPath = (match[1] ?? "").replace(/\.git$/, "");

  const cacheKey = `gh-releases:${repoPath}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  try {
    // GitHub releases API has no server-side prerelease filter — we must fetch
    // a window and filter client-side. Canary-heavy projects (Next.js, etc.)
    // can have the top 3 entries all be prereleases, so fetch 30 (the API default)
    // to ensure we see real stable releases.
    // ref: https://docs.github.com/en/rest/releases/releases#list-releases
    const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=30`;
    // GT_GITHUB_TOKEN raises rate limit from 60/hr to 5000/hr
    const res = await fetchWithTimeout(apiUrl, 10_000, githubAuthHeaders());
    // 403 = rate limit (unauthenticated: 60 req/hr), 429 = explicit rate limit
    if (res.status === 403 || res.status === 429 || !res.ok) return null;
    const releases = (await res.json()) as Array<{
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      prerelease?: boolean;
      draft?: boolean;
    }>;

    if (!Array.isArray(releases) || releases.length === 0) return null;

    // Filter out prereleases (canary, beta, rc) + drafts, keep top 3 stable.
    // Fall back to including prereleases if NO stable exists (some libs
    // ship canary-only between major releases).
    const stable = releases.filter((r) => !r.prerelease && !r.draft).slice(0, 3);
    const picked = stable.length > 0 ? stable : releases.filter((r) => !r.draft).slice(0, 3);
    if (picked.length === 0) return null;

    const lines: string[] = ["## Recent Releases\n"];
    for (const r of picked) {
      const label = r.tag_name ?? r.name ?? "Release";
      const tag = r.prerelease ? `${label} _(prerelease)_` : label;
      lines.push(`### ${tag}`);
      if (r.published_at) lines.push(`_Published: ${r.published_at.slice(0, 10)}_`);
      if (r.body) lines.push(r.body.slice(0, 2000));
      lines.push("");
    }

    const content = lines.join("\n");
    cacheDoc(cacheKey, content, CACHE_TTLS.GITHUB_RELEASES);
    return content;
  } catch (err: unknown) {
    log({ level: "debug", msg: "fetchGitHubReleases.error", repo: repoPath, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Fetch examples or migration guides from official GitHub repo */
export async function fetchGitHubExamples(githubUrl: string): Promise<string | null> {
  const match = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repoPath = (match[1] ?? "").replace(/\.git$/, "");

  const cacheKey = `gh-examples:${repoPath}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  // Try common docs paths that contain best practices / examples
  const paths = [
    "CHANGELOG.md",
    "MIGRATION.md",
    "docs/MIGRATION.md",
    "docs/migration.md",
    "docs/best-practices.md",
    "docs/BEST_PRACTICES.md",
    "docs/patterns.md",
  ];

  // Try up to 6 candidates concurrently — return first hit
  const candidates = paths.flatMap((path) =>
    ["main", "master"].map((branch) => ({ path, branch })),
  );

  const CONCURRENCY = 6;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ path, branch }) => {
        const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${path}`;
        const content = await tryFetch(url, 0, githubAuthHeaders());
        if (content && content.length > 300) {
          return `## ${path} (GitHub)\n\n${content.slice(0, 4000)}`;
        }
        return null;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        cacheDoc(cacheKey, result.value, CACHE_TTLS.CHANGELOG);
        return result.value;
      }
    }
  }

  return null;
}
