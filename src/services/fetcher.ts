import { FETCH_TIMEOUT_MS, JINA_BASE_URL } from "../constants.js";
import type { FetchResult } from "../types.js";
import { docCache } from "./cache.js";

const USER_AGENT =
  "ws-mcp-server/1.0 (docs-fetcher; +https://github.com/senorit/ws-mcp-server)";

// In-flight deduplication: prevents N concurrent fetches of the same URL
const inFlightRequests = new Map<string, Promise<string | null>>();

export async function fetchWithTimeout(
  url: string,
  ms = FETCH_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/html,*/*", ...extraHeaders },
    });
  } finally {
    clearTimeout(id);
  }
}

async function tryFetch(url: string, retries = 1): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.status === 429 || res.status === 503) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > 100 ? text : null;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return null;
}

/** Fetch via Jina Reader — converts any URL to clean markdown */
export async function fetchViaJina(url: string): Promise<string | null> {
  const jinaUrl = `${JINA_BASE_URL}/${url}`;
  const cacheKey = `jina:${url}`;
  const cached = docCache.get(cacheKey);
  if (cached) return cached;

  // Deduplicate concurrent requests for the same URL
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(jinaUrl, 25_000, { "X-Return-Format": "markdown" });
        if (res.status === 429 || res.status === 503) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          return null;
        }
        if (!res.ok) return null;
        const text = await res.text();
        if (text.length < 200) return null;
        docCache.set(cacheKey, text);
        return text;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/** Try llms.txt, then llms-full.txt, then Jina, then direct HTML */
export async function fetchDocs(
  docsUrl: string,
  llmsTxtUrl?: string,
  llmsFullTxtUrl?: string,
): Promise<FetchResult> {
  const cacheKey = `docs:${llmsTxtUrl ?? docsUrl}`;
  const cached = docCache.get(cacheKey);
  if (cached) {
    return { content: cached, url: llmsTxtUrl ?? docsUrl, sourceType: "llms-txt" };
  }

  // 1. Race llms-full.txt and llms.txt in parallel (both are cheap GETs)
  if (llmsFullTxtUrl || llmsTxtUrl) {
    const candidates: Array<{ url: string; sourceType: FetchResult["sourceType"] }> = [];
    if (llmsFullTxtUrl) candidates.push({ url: llmsFullTxtUrl, sourceType: "llms-full-txt" });
    if (llmsTxtUrl) candidates.push({ url: llmsTxtUrl, sourceType: "llms-txt" });

    const results = await Promise.all(
      candidates.map(async (c) => ({ ...c, content: await tryFetch(c.url) })),
    );

    // Prefer llms-full.txt > llms.txt
    for (const r of results) {
      if (r.content) {
        docCache.set(cacheKey, r.content);
        return { content: r.content, url: r.url, sourceType: r.sourceType };
      }
    }

    // Auto-discover from the domain root of the provided llms.txt URL
    if (llmsTxtUrl) {
      try {
        const origin = new URL(llmsTxtUrl).origin;
        const autoDiscovered = await tryFetch(`${origin}/llms.txt`);
        if (autoDiscovered) {
          docCache.set(cacheKey, autoDiscovered);
          return { content: autoDiscovered, url: `${origin}/llms.txt`, sourceType: "llms-txt" };
        }
      } catch { /* invalid URL */ }
    }
  }

  // 2. Try auto-discovering llms.txt from docs URL
  try {
    const origin = new URL(docsUrl).origin;
    const autoDiscover = await tryFetch(`${origin}/llms.txt`);
    if (autoDiscover) {
      docCache.set(cacheKey, autoDiscover);
      return { content: autoDiscover, url: `${origin}/llms.txt`, sourceType: "llms-txt" };
    }
  } catch {
    // invalid URL, skip
  }

  // 3. Jina Reader (renders JS, returns clean markdown)
  const jinaContent = await fetchViaJina(docsUrl);
  if (jinaContent) {
    docCache.set(cacheKey, jinaContent);
    return { content: jinaContent, url: docsUrl, sourceType: "jina" };
  }

  // 4. Direct fetch as last resort
  const directContent = await tryFetch(docsUrl);
  if (directContent) {
    docCache.set(cacheKey, directContent);
    return { content: directContent, url: docsUrl, sourceType: "direct" };
  }

  throw new Error(`Failed to fetch documentation from ${docsUrl}`);
}

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
  const cached = docCache.get(cacheKey);
  if (cached) {
    return { content: cached, url: githubUrl, sourceType: "github-readme" };
  }

  for (const branch of ["main", "master"]) {
    const rawUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${path}`;
    const content = await tryFetch(rawUrl);
    if (content) {
      docCache.set(cacheKey, content);
      return { content, url: rawUrl, sourceType: "github-readme" };
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
  const cached = docCache.get(cacheKey);
  if (cached) return cached;

  try {
    const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=3`;
    const res = await fetchWithTimeout(apiUrl, 10_000);
    // 403 = rate limit (unauthenticated: 60 req/hr), 429 = explicit rate limit
    if (res.status === 403 || res.status === 429 || !res.ok) return null;
    const releases = (await res.json()) as Array<{
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      prerelease?: boolean;
    }>;

    if (!Array.isArray(releases) || releases.length === 0) return null;

    const lines: string[] = ["## Recent Releases\n"];
    for (const r of releases.slice(0, 3)) {
      if (r.prerelease) continue;
      lines.push(`### ${r.tag_name ?? r.name ?? "Release"}`);
      if (r.published_at) lines.push(`_Published: ${r.published_at.slice(0, 10)}_`);
      if (r.body) lines.push(r.body.slice(0, 2000));
      lines.push("");
    }

    const content = lines.join("\n");
    docCache.set(cacheKey, content, 60 * 60 * 1000); // 1 hour
    return content;
  } catch {
    return null;
  }
}

/** Fetch examples or migration guides from official GitHub repo */
export async function fetchGitHubExamples(githubUrl: string): Promise<string | null> {
  const match = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repoPath = (match[1] ?? "").replace(/\.git$/, "");

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

  for (const path of paths) {
    for (const branch of ["main", "master"]) {
      const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${path}`;
      const content = await tryFetch(url);
      if (content && content.length > 300) {
        return `## ${path} (GitHub)\n\n${content.slice(0, 4000)}`;
      }
    }
  }

  return null;
}

/** Query npm registry for package metadata */
export async function fetchNpmPackage(packageName: string): Promise<unknown> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const cacheKey = `npm:${packageName}`;
  const cached = docCache.get(cacheKey);
  if (cached) return JSON.parse(cached) as unknown;

  const content = await tryFetch(url);
  if (!content) return null;

  try {
    const data = JSON.parse(content);
    docCache.set(cacheKey, content, 60 * 60 * 1000); // 1 hour for npm data
    return data as unknown;
  } catch {
    return null;
  }
}

/** Query PyPI for package metadata */
export async function fetchPypiPackage(packageName: string): Promise<unknown> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
  const cacheKey = `pypi:${packageName}`;
  const cached = docCache.get(cacheKey);
  if (cached) return JSON.parse(cached) as unknown;

  const content = await tryFetch(url);
  if (!content) return null;

  try {
    const data = JSON.parse(content);
    docCache.set(cacheKey, content, 60 * 60 * 1000);
    return data as unknown;
  } catch {
    return null;
  }
}
