import { CACHE_TTLS } from "../constants.js";
import type { FetchResult } from "../types.js";
import { log } from "../utils/logger.js";
import { fetchWithTimeout, cacheDoc, githubAuthHeaders } from "./http/request.js";
import { tryFetch } from "./http/try-fetch.js";
import { readThrough } from "./http/swr.js";
import { discardBody, readBodyCapped, responseHeader } from "./http/body.js";
import { isKnownMissing, rememberMissing } from "./http/negative-cache.js";
import { hasDotSegment } from "./github-url.js";

export { isGitHubHost } from "./github-url.js";

/** How long api.github.com is left alone once it answered with its rate limit. */
const RATE_LIMIT_PAUSE_MS = 60_000;
let apiPausedUntil = 0;

/**
 * GET an api.github.com URL: the body, or null for a non-ok answer (network
 * errors throw). Its rate limit (403/429 with x-ratelimit-remaining 0 or
 * retry-after) pauses every API call for RATE_LIMIT_PAUSE_MS, so a spent budget
 * is not spent again on certain refusals.
 */
async function apiGet(url: string, headers: Record<string, string>): Promise<string | null> {
  if (Date.now() < apiPausedUntil || isKnownMissing(url)) return null;
  const res = await fetchWithTimeout(url, 10_000, headers);
  if (res.ok) return readBodyCapped(res);
  discardBody(res);
  const limited = responseHeader(res, "x-ratelimit-remaining") === "0" || responseHeader(res, "retry-after") !== null;
  if ((res.status === 403 || res.status === 429) && limited) apiPausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
  if (res.status === 404) rememberMissing(url);
  return null;
}

/**
 * Fetch GitHub README or a specific file from a repo. `authenticated: false`
 * keeps GT_GITHUB_TOKEN off requests built from a caller-supplied URL, so a
 * caller cannot read the operator's private repos through it.
 */
export async function fetchGitHubContent(
  githubUrl: string,
  path = "README.md",
  authenticated = true,
): Promise<FetchResult | null> {
  // Registry docsUrls carry #readme / #documentation fragments; they must not leak into the raw path.
  const match = githubUrl.match(/github\.com\/([^/#?]+\/[^/#?]+)/);
  if (!match) return null;
  const repoPath = match[1]!.replace(/\.git$/, "");
  if (hasDotSegment(repoPath) || hasDotSegment(path)) return null;
  const auth = authenticated ? githubAuthHeaders() : {};

  // Anonymous reads get their own key: a token-read private file must never answer them.
  const cacheKey = `gh:${repoPath}:${path}${authenticated ? "" : ":anon"}`;

  // HEAD resolves the repo's default branch (canary, develop, ...) in one
  // request, where probing main then master cost two serial 404s on those repos.
  const rawUrl = `https://raw.githubusercontent.com/${repoPath}/HEAD/${path}`;
  // Fallback: GitHub REST API on the default branch. Works unauthenticated
  // (60 req/hr); GT_GITHUB_TOKEN raises it to 5000/hr. /readme also finds
  // readme.md / README.rst, which the exact-name raw path misses.
  const apiUrl = path === "README.md"
    ? `https://api.github.com/repos/${repoPath}/readme`
    : `https://api.github.com/repos/${repoPath}/contents/${path}`;
  let url = githubUrl;
  const content = await readThrough(cacheKey, async () => {
    const raw = await tryFetch(rawUrl, 1, auth);
    if (raw) {
      url = rawUrl;
      return raw;
    }
    const api = await apiGet(apiUrl, { Accept: "application/vnd.github.raw+json", ...auth }).catch((err: unknown) => {
      log({ level: "debug", msg: "fetchGitHubContent.api_error", repo: repoPath, error: err instanceof Error ? err.message : String(err) });
      return null;
    });
    if (api) url = apiUrl;
    return api;
  }, (c) => cacheDoc(cacheKey, c, CACHE_TTLS.GITHUB_README));
  return content ? { content, url, sourceType: "github-readme" } : null;
}

/** Fetch latest GitHub release notes (tag name + body) */
export async function fetchGitHubReleases(githubUrl: string): Promise<string | null> {
  const match = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repoPath = (match[1] ?? "").replace(/\.git$/, "");

  const cacheKey = `gh-releases:${repoPath}`;

  return readThrough(cacheKey, () => fetchReleaseNotes(repoPath), (c) => cacheDoc(cacheKey, c, CACHE_TTLS.GITHUB_RELEASES));
}

async function fetchReleaseNotes(repoPath: string): Promise<string | null> {
  try {
    // GitHub releases API has no server-side prerelease filter — we must fetch
    // a window and filter client-side. Canary-heavy projects (Next.js, etc.)
    // can have the top 3 entries all be prereleases, so fetch 30 (the API default)
    // to ensure we see real stable releases.
    // ref: https://docs.github.com/en/rest/releases/releases#list-releases
    const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=30`;
    // GT_GITHUB_TOKEN raises rate limit from 60/hr to 5000/hr
    const body = await apiGet(apiUrl, githubAuthHeaders());
    if (!body) return null;
    const releases = JSON.parse(body) as Array<{
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

    return lines.join("\n");
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

  return readThrough(cacheKey, () => fetchExamplesFile(repoPath), (c) => cacheDoc(cacheKey, c, CACHE_TTLS.CHANGELOG));
}

async function fetchExamplesFile(repoPath: string): Promise<string | null> {
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
  const CONCURRENCY = 6;
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (path) => {
        // HEAD = the default branch, one request per path instead of main + master.
        const url = `https://raw.githubusercontent.com/${repoPath}/HEAD/${path}`;
        const content = await tryFetch(url, 0, githubAuthHeaders());
        if (content && content.length > 300) {
          return `## ${path} (GitHub)\n\n${content.slice(0, 4000)}`;
        }
        return null;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) return result.value;
    }
  }

  return null;
}
