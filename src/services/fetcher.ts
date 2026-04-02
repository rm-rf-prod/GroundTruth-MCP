import { createHash } from "crypto";
import dns from "dns";
import { isIPv4, isIPv6 } from "net";
import { Agent, setGlobalDispatcher } from "undici";
import { FETCH_TIMEOUT_MS, JINA_BASE_URL, SERVER_VERSION, MAX_CONCURRENT_FETCHES, CACHE_TTLS } from "../constants.js";
import { extractDomain, isCircuitOpen, recordSuccess, recordFailure } from "./circuit-breaker.js";
import type { FetchResult } from "../types.js";
import { docCache, diskDocCache } from "./cache.js";
import { assertPublicUrl } from "../utils/guard.js";
import { convertHtmlToMarkdown } from "../utils/html-to-md.js";

/**
 * Global fetch semaphore — caps total concurrent outbound HTTP requests.
 * Prevents request storms from tools like gt_auto_scan (20 libs x 6 fetches each)
 * that cause upstream 429s and MCP client 529 overloaded errors.
 */
class FetchSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }
}

export const fetchSemaphore = new FetchSemaphore(MAX_CONCURRENT_FETCHES);

export function isBlockedIP(address: string): boolean {
  if (isIPv4(address)) {
    const parts = address.split(".").map(Number);
    const int = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
    // All masks use >>> 0 to stay in unsigned 32-bit space (JS bitwise & returns signed)
    return (
      ((int & 0xff000000) >>> 0) === 0x7f000000 || // 127.0.0.0/8
      ((int & 0xff000000) >>> 0) === 0x00000000 || // 0.0.0.0/8
      ((int & 0xff000000) >>> 0) === 0x0a000000 || // 10.0.0.0/8
      ((int & 0xfff00000) >>> 0) === 0xac100000 || // 172.16.0.0/12
      ((int & 0xffff0000) >>> 0) === 0xc0a80000 || // 192.168.0.0/16
      ((int & 0xffff0000) >>> 0) === 0xa9fe0000 || // 169.255.1.0/16
      ((int & 0xf0000000) >>> 0) === 0xe0000000    // 225.1.0.0/4 multicast
    );
  }
  if (isIPv6(address)) {
    const lower = address.toLowerCase();
    return (
      lower === "::1" || lower === "::" ||
      lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb") ||
      lower.startsWith("ff") || lower.startsWith("::ffff:")
    );
  }
  return true;
}

setGlobalDispatcher(new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        const entries = (Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }]) as Array<{ address: string; family: number }>;
        const safe = entries.filter((entry) => !isBlockedIP(entry.address));
        if (safe.length === 0) {
          return callback(new Error(`SSRF blocked: ${hostname} resolves to private/blocked IP`), "", 4);
        }
        // Undici expects array format when options.all is true, single entry otherwise
        if (options.all) {
          return (callback as unknown as (err: null, entries: Array<{ address: string; family: number }>) => void)(null, safe);
        }
        const first = safe[0]!;
        callback(null, first.address, first.family as 4 | 6);
      });
    },
  },
}));

const MAX_REDIRECTS = 5;

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const USER_AGENT =
  `GroundTruth/${SERVER_VERSION} (docs-fetcher; +https://github.com/rm-rf-prod/GroundTruth-MCP)`;

// In-flight deduplication: prevents N concurrent fetches of the same URL
const inFlightRequests = new Map<string, Promise<string | null>>();

/** Build Authorization header for GitHub API if GT_GITHUB_TOKEN is set */
export function githubAuthHeaders(): Record<string, string> {
  const token = process.env.GT_GITHUB_TOKEN;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function fetchWithTimeout(
  url: string,
  ms = FETCH_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  await fetchSemaphore.acquire();
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    let currentUrl = url;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/html,*/*", "Accept-Language": "en-US,en;q=0.9", ...extraHeaders },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res;
        currentUrl = new URL(location, currentUrl).href;
        try { assertPublicUrl(currentUrl); } catch { return res; }
        continue;
      }
      return res;
    }
    throw new Error(`Too many redirects for ${url}`);
  } finally {
    clearTimeout(id);
    fetchSemaphore.release();
  }
}

async function tryFetch(url: string, retries = 1, extraHeaders?: Record<string, string>): Promise<string | null> {
  try { assertPublicUrl(url); } catch { return null; }
  const domain = extractDomain(url);
  if (isCircuitOpen(domain)) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, extraHeaders);
      if (res.status === 429 || res.status === 503) {
        recordFailure(domain);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      if (!res.ok) {
        recordFailure(domain);
        return null;
      }
      const text = await res.text();
      if (text.length > 50) {
        recordSuccess(domain);
        return text;
      }
      return null;
    } catch {
      recordFailure(domain);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return null;
}

/** Fetch via Jina Reader — converts any URL to clean markdown */
export async function fetchViaJina(url: string): Promise<string | null> {
  try {
    assertPublicUrl(url);
  } catch {
    return null;
  }

  const jinaDomain = extractDomain(JINA_BASE_URL);
  if (isCircuitOpen(jinaDomain)) return null;

  const jinaUrl = `${JINA_BASE_URL}/${url}`;
  const cacheKey = `jina:${url}`;

  // Check memory cache first
  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  // Check disk cache (survives across npx invocations)
  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached); // warm memory cache
    return diskCached;
  }

  // Deduplicate concurrent requests for the same URL
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(jinaUrl, 25_000, {
          "X-Return-Format": "markdown",
          "X-Exclude-Selector": "nav,footer,aside,.sidebar,.ads,#comments,.cookie-banner,.cookie-consent,#cookie-notice,.newsletter-signup",
          "X-Wait-For-Selector": "main,article,.docs-content,[role=main]",
        });
        if (res.status === 429 || res.status === 503) {
          recordFailure(jinaDomain);
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          return null;
        }
        if (!res.ok) {
          recordFailure(jinaDomain);
          return null;
        }
        const text = await res.text();
        if (text.length < 100) return null;
        recordSuccess(jinaDomain);
        docCache.set(cacheKey, text, CACHE_TTLS.JINA_RESULT);
        void diskDocCache.set(cacheKey, text, CACHE_TTLS.JINA_RESULT);
        return text;
      } catch {
        recordFailure(jinaDomain);
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

/**
 * Fetch a URL as markdown, trying direct HTML extraction first (fast, no Jina dependency),
 * then falling back to Jina Reader for JS-rendered pages.
 * This is the core reliability improvement — provides two independent paths to content.
 */
export async function fetchAsMarkdown(url: string): Promise<string | null> {
  const cacheKey = `md:${url}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  // Deduplicate concurrent requests
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    // Path 1: Direct fetch + HTML-to-Markdown extraction (fast, no Jina)
    const directHtml = await tryFetch(url, 1);
    if (directHtml) {
      // Check if it's already markdown/plain text (llms.txt, README)
      const tagDensity = (directHtml.match(/<[a-z]/gi) ?? []).length / Math.max(directHtml.length, 1);
      if (tagDensity < 0.005 && directHtml.length > 100 && !isGarbageContent(directHtml).garbage) {
        docCache.set(cacheKey, directHtml, CACHE_TTLS.DOCS_PAGE);
        void diskDocCache.set(cacheKey, directHtml, CACHE_TTLS.DOCS_PAGE);
        return directHtml;
      }

      // Extract markdown from HTML
      const markdown = convertHtmlToMarkdown(directHtml);
      if (markdown.length >= 200 && !isGarbageContent(markdown).garbage) {
        docCache.set(cacheKey, markdown, CACHE_TTLS.DOCS_PAGE);
        void diskDocCache.set(cacheKey, markdown, CACHE_TTLS.DOCS_PAGE);
        return markdown;
      }
    }

    // Path 2: Jina Reader (handles JS-rendered pages, but rate-limited)
    const jinaResult = await fetchViaJina(url);
    if (jinaResult && jinaResult.length >= 100) {
      docCache.set(cacheKey, jinaResult, CACHE_TTLS.DOCS_PAGE);
      void diskDocCache.set(cacheKey, jinaResult, CACHE_TTLS.DOCS_PAGE);
      return jinaResult;
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

/**
 * Race direct HTML extraction against Jina Reader — first good result wins.
 * Use this when you need fast, reliable content and the URL might or might not need JS rendering.
 */
export async function fetchAsMarkdownRace(url: string): Promise<string | null> {
  const cacheKey = `md:${url}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    try {
      const result = await Promise.any([
        // Path 1: Direct fetch + HTML extraction (usually faster)
        (async () => {
          const html = await tryFetch(url, 0);
          if (!html) throw new Error("no content");
          const tagDensity = (html.match(/<[a-z]/gi) ?? []).length / Math.max(html.length, 1);
          if (tagDensity < 0.005 && html.length > 100) {
            if (isGarbageContent(html).garbage) throw new Error("garbage content");
            return html;
          }
          const md = convertHtmlToMarkdown(html);
          if (md.length >= 200) {
            if (isGarbageContent(md).garbage) throw new Error("garbage content after extraction");
            return md;
          }
          throw new Error("extraction too short");
        })(),
        // Path 2: Jina Reader (handles JS-rendered sites)
        (async () => {
          const md = await fetchViaJina(url);
          if (md && md.length >= 100) return md;
          throw new Error("jina failed");
        })(),
      ]);

      docCache.set(cacheKey, result, CACHE_TTLS.DOCS_PAGE);
      void diskDocCache.set(cacheKey, result, CACHE_TTLS.DOCS_PAGE);
      return result;
    } catch {
      return null;
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Detect if extracted content is actually an unprocessed HTML blob.
 * JS-rendered sites return HTML shells with no real content — these should be rejected.
 */
export function isHtmlBlob(content: string): boolean {
  if (content.length < 200) return false;
  const sample = content.slice(0, 5000);
  const htmlSignals = [
    /<!DOCTYPE\s+html/i.test(sample),
    /<meta\s[^>]*charSet=/i.test(sample),
    /<link\s[^>]*rel="preload"/i.test(sample),
    /class="[^"]{50,}"/i.test(sample),
    /\bdata:text\/javascript;base64,/.test(sample),
    /\b_next\/static\//.test(sample),
    /<script[\s>]/i.test(sample),
    // Gatsby / static-site generator signals
    /id="___gatsby"/i.test(sample),
    /data-react-helmet="true"/i.test(sample),
    // Generic SPA shell signals
    /<link\s[^>]*rel="apple-touch-icon"/i.test(sample) && (sample.match(/apple-touch-icon/gi) ?? []).length >= 3,
    /<div\s+id="(root|app|__next)"[^>]*>\s*<\/div>/i.test(sample),
  ];
  return htmlSignals.filter(Boolean).length >= 3;
}

/**
 * Detect if content is a TOC/index page (list of links) rather than actual documentation.
 * These are common in llms.txt files that serve as directories rather than content.
 */
export function isIndexContent(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 5) return false;
  const linkLines = lines.filter((l) => /^\s*-?\s*\[.+\]\(https?:\/\/.+\)/.test(l));
  return linkLines.length / lines.length > 0.5;
}

/**
 * Extract URLs from an index/TOC page and score them against a topic query.
 * Returns the best-matching URLs sorted by relevance.
 */
export function rankIndexLinks(content: string, topic: string): string[] {
  const links: Array<{ url: string; text: string; score: number }> = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    if (match[1] && match[2]) {
      links.push({ url: match[2], text: match[1].toLowerCase(), score: 0 });
    }
  }

  if (!topic || links.length === 0) return links.slice(0, 5).map((l) => l.url);

  const queryWords = topic
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length > 2);

  for (const link of links) {
    const combined = link.text + " " + link.url.toLowerCase();
    for (const word of queryWords) {
      if (combined.includes(word)) link.score += 10;
    }
  }

  return links
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((l) => l.url);
}

/** Try llms.txt, then llms-full.txt, then Jina, then direct HTML */
export async function fetchDocs(
  docsUrl: string,
  llmsTxtUrl?: string,
  llmsFullTxtUrl?: string,
  _topic?: string,
): Promise<FetchResult> {
  const cacheKey = `docs:${docsUrl}`;

  function stamp(result: FetchResult): FetchResult {
    return { ...result, contentHash: hashContent(result.content), fetchedAt: new Date().toISOString() };
  }

  const memCached = docCache.get(cacheKey);
  if (memCached) {
    return stamp({ content: memCached, url: docsUrl, sourceType: "llms-txt" });
  }

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return stamp({ content: diskCached, url: docsUrl, sourceType: "llms-txt" });
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
        docCache.set(cacheKey, r.content, CACHE_TTLS.LLMS_TXT);
        void diskDocCache.set(cacheKey, r.content, CACHE_TTLS.LLMS_TXT);
        return stamp({ content: r.content, url: r.url, sourceType: r.sourceType });
      }
    }

    // Auto-discover from the domain root of the provided llms.txt URL
    if (llmsTxtUrl) {
      try {
        const origin = new URL(llmsTxtUrl).origin;
        const autoDiscovered = await tryFetch(`${origin}/llms.txt`);
        if (autoDiscovered) {
          docCache.set(cacheKey, autoDiscovered, CACHE_TTLS.LLMS_TXT);
          void diskDocCache.set(cacheKey, autoDiscovered, CACHE_TTLS.LLMS_TXT);
          return stamp({ content: autoDiscovered, url: `${origin}/llms.txt`, sourceType: "llms-txt" });
        }
      } catch { /* invalid URL */ }
    }
  }

  // 2. Race auto-discover + direct HTML extraction + Jina — first good result wins
  const autoDiscoverUrls: string[] = [];
  try {
    const origin = new URL(docsUrl).origin;
    autoDiscoverUrls.push(
      `${origin}/llms.txt`,
      `${origin}/llms-full.txt`,
      `${origin}/docs/llms.txt`,
      `${origin}/docs/llms-full.txt`,
    );
  } catch { /* invalid URL */ }

  const candidates: Array<Promise<FetchResult>> = [];
  for (const adUrl of autoDiscoverUrls) {
    candidates.push(
      tryFetch(adUrl).then((c) => {
        if (c) return { content: c, url: adUrl, sourceType: "llms-txt" as const };
        throw new Error("no content");
      }),
    );
  }
  // Direct HTML fetch + extraction (fast, no Jina dependency)
  candidates.push(
    (async () => {
      const html = await tryFetch(docsUrl, 0);
      if (!html) throw new Error("no content");
      const tagDensity = (html.match(/<[a-z]/gi) ?? []).length / Math.max(html.length, 1);
      // Already plain text / markdown
      if (tagDensity < 0.005 && html.length > 100) {
        return { content: html, url: docsUrl, sourceType: "direct" as const };
      }
      const md = convertHtmlToMarkdown(html);
      if (md.length >= 200) {
        return { content: md, url: docsUrl, sourceType: "direct" as const };
      }
      throw new Error("extraction too short");
    })(),
  );
  // Jina Reader (handles JS-rendered sites)
  candidates.push(
    fetchViaJina(docsUrl).then((c) => {
      if (c) return { content: c, url: docsUrl, sourceType: "jina" as const };
      throw new Error("no content");
    }),
  );

  try {
    const hit = await Promise.any(candidates);
    docCache.set(cacheKey, hit.content, CACHE_TTLS.DOCS_PAGE);
    void diskDocCache.set(cacheKey, hit.content, CACHE_TTLS.DOCS_PAGE);
    return stamp(hit);
  } catch {
    // All candidates failed — fall through to error
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
      docCache.set(cacheKey, content, CACHE_TTLS.GITHUB_README);
      void diskDocCache.set(cacheKey, content, CACHE_TTLS.GITHUB_README);
      return { content, url: rawUrl, sourceType: "github-readme" };
    }
  }

  // Fallback: GitHub REST API with auth (5000/hr vs 60/hr unauthenticated)
  const token = process.env.GT_GITHUB_TOKEN;
  if (token) {
    for (const branch of ["main", "master"]) {
      const apiUrl = `https://api.github.com/repos/${repoPath}/contents/${path}?ref=${branch}`;
      const content = await tryFetch(apiUrl, 0, {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
      });
      if (content) {
        docCache.set(cacheKey, content, CACHE_TTLS.GITHUB_README);
        void diskDocCache.set(cacheKey, content, CACHE_TTLS.GITHUB_README);
        return { content, url: apiUrl, sourceType: "github-readme" };
      }
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
    const apiUrl = `https://api.github.com/repos/${repoPath}/releases?per_page=3`;
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
    docCache.set(cacheKey, content, CACHE_TTLS.GITHUB_RELEASES);
    void diskDocCache.set(cacheKey, content, CACHE_TTLS.GITHUB_RELEASES);
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
        docCache.set(cacheKey, result.value, CACHE_TTLS.CHANGELOG);
        void diskDocCache.set(cacheKey, result.value, CACHE_TTLS.CHANGELOG);
        return result.value;
      }
    }
  }

  return null;
}

/** Query npm registry for package metadata */
export async function fetchNpmPackage(packageName: string): Promise<unknown> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const cacheKey = `npm:${packageName}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return JSON.parse(memCached) as unknown;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return JSON.parse(diskCached) as unknown;
  }

  const content = await tryFetch(url);
  if (!content) return null;

  try {
    const data = JSON.parse(content);
    docCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    void diskDocCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    return data as unknown;
  } catch {
    return null;
  }
}

const DEVDOCS_SLUGS: Record<string, string> = {
  react: "react", node: "node", python: "python~3.12", go: "go",
  typescript: "typescript", javascript: "javascript", rust: "rust",
  css: "css", html: "html", postgresql: "postgresql~16", redis: "redis",
  mongodb: "mongodb", docker: "docker", nginx: "nginx", git: "git",
  bash: "bash", ruby: "ruby~3.3", php: "php", java: "openjdk~21",
  kotlin: "kotlin", swift: "swift", dart: "dart~3", elixir: "elixir",
  django: "django~5.0", flask: "flask~3.0", express: "express",
  vue: "vue~3", angular: "angular", svelte: "svelte",
  tailwindcss: "tailwindcss", rails: "ruby_on_rails~7.1", laravel: "laravel~11",
};

/** Fetch documentation from devdocs.io — pre-parsed, offline-capable docs for 200+ technologies */
export async function fetchDevDocs(slug: string, topic?: string): Promise<string | null> {
  const resolvedSlug = DEVDOCS_SLUGS[slug.toLowerCase()] ?? slug.toLowerCase();
  const slugEncoded = encodeURIComponent(resolvedSlug);
  const cacheKey = `devdocs:${slugEncoded}:${topic ?? ""}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  // Try topic-specific doc page first, then root page
  const topicSlug = topic ? topic.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : "";
  const urls = topic
    ? [
        `https://devdocs.io/${slugEncoded}/${topicSlug}`,
        `https://devdocs.io/${slugEncoded}/`,
      ]
    : [`https://devdocs.io/${slugEncoded}/`];

  for (const url of urls) {
    const content = await fetchViaJina(url);
    if (content && content.length >= 200 && !isErrorPage(content)) {
      docCache.set(cacheKey, content, CACHE_TTLS.DEVDOCS);
      void diskDocCache.set(cacheKey, content, CACHE_TTLS.DEVDOCS);
      return content;
    }
  }
  return null;
}

/** Detect 404/error pages returned as content (common with Jina on non-existent pages) */
export function isErrorPage(content: string): boolean {
  const sample = content.slice(0, 1500).toLowerCase();
  return (
    (/page\s*not\s*found|404\s*not\s*found|oops!.*doesn.t\s*exist/i.test(sample) && content.length < 3000) ||
    (/^#\s*(404|page not found|not found)/im.test(sample))
  );
}

/** Detect login/auth walls — content requiring the user to sign in before reading */
export function isLoginWall(content: string): boolean {
  const sample = content.slice(0, 5000).toLowerCase();
  const signals = [
    /sign\s+in\s+to\s+continue/.test(sample),
    /log\s+in\s+to\s+access/.test(sample),
    /create\s+an\s+account/.test(sample),
    /you\s+must\s+be\s+logged\s+in/.test(sample),
    /authentication\s+required/.test(sample),
    /subscribe\s+to\s+access/.test(sample),
    /premium\s+content/.test(sample),
    /members\s+only/.test(sample),
  ];
  return content.length < 1000 && signals.some(Boolean);
}

/** Detect Cloudflare browser challenges and bot-check pages */
export function isCloudflareChallenge(content: string): boolean {
  const sample = content.slice(0, 5000).toLowerCase();
  return (
    /checking\s+your\s+browser/.test(sample) ||
    /just\s+a\s+moment/.test(sample) ||
    /ray\s+id/.test(sample) ||
    /enable\s+javascript\s+and\s+cookies/.test(sample) ||
    /attention\s+required/.test(sample) ||
    /cf-browser-verification/.test(sample) ||
    /challenge-platform/.test(sample) ||
    /_cf_chl/.test(sample)
  );
}

/** Detect rate-limit responses masquerading as content */
export function isRateLimitPage(content: string): boolean {
  const sample = content.slice(0, 5000).toLowerCase();
  return (
    /rate\s+limit\s+exceeded/.test(sample) ||
    /too\s+many\s+requests/.test(sample) ||
    /\b429\b/.test(sample) ||
    /please\s+try\s+again\s+later/.test(sample) ||
    /slow\s+down/.test(sample) ||
    /api\s+rate\s+limit/.test(sample) ||
    /quota\s+exceeded/.test(sample)
  );
}

/** Detect marketing/landing pages that contain no actual documentation */
export function isMarketingPage(content: string): boolean {
  if (content.length < 500) return false;
  const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).length;
  if (codeBlocks >= 1) return false;
  const sample = content.slice(0, 5000).toLowerCase();
  const signals = [
    /start\s+(your\s+)?free\s+trial/.test(sample),
    /book\s+a\s+demo/.test(sample),
    /trusted\s+by/.test(sample),
    /customer\s+stories/.test(sample),
    /enterprise\s+plan/.test(sample),
    /\bpricing\b/.test(sample),
  ];
  return signals.filter(Boolean).length >= 2;
}

/** Detect SPA shells that have not rendered any meaningful content */
export function isEmptySPAShell(content: string): boolean {
  const sample = content.slice(0, 5000);
  const sampleLower = sample.toLowerCase();

  const hasSpaRoot =
    /<div\s+id="root"\s*>\s*<\/div>/i.test(sample) ||
    /<div\s+id="app"\s*>\s*<\/div>/i.test(sample);

  const hasLoadingSignal =
    /loading\.\.\./i.test(sampleLower) ||
    /please\s+enable\s+javascript/i.test(sampleLower);

  const textContent = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const thinText = textContent.length < 100;

  return thinText || hasSpaRoot || hasLoadingSignal;
}

/**
 * Unified content quality gate.
 * Runs all garbage-detection checks in priority order and returns the first hit.
 * Returns `{ garbage: false, reason: "" }` when content is clean.
 */
export function isGarbageContent(content: string): { garbage: boolean; reason: string } {
  if (isEmptySPAShell(content)) return { garbage: true, reason: "empty SPA shell" };
  if (isCloudflareChallenge(content)) return { garbage: true, reason: "Cloudflare challenge" };
  if (isRateLimitPage(content)) return { garbage: true, reason: "rate limit page" };
  if (isLoginWall(content)) return { garbage: true, reason: "login wall" };
  if (isErrorPage(content)) return { garbage: true, reason: "error page" };
  if (isHtmlBlob(content)) return { garbage: true, reason: "HTML blob" };
  if (isMarketingPage(content)) return { garbage: true, reason: "marketing page" };
  return { garbage: false, reason: "" };
}

/** Fetch and parse sitemap.xml to discover all doc page URLs */
export async function fetchSitemapUrls(docsUrl: string): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(docsUrl).origin;
  } catch {
    return [];
  }

  const cacheKey = `sitemap:${origin}`;
  const memCached = docCache.get(cacheKey);
  if (memCached) {
    try { return JSON.parse(memCached) as string[]; } catch { /* invalid cache */ }
  }

  const sitemapUrl = `${origin}/sitemap.xml`;
  const content = await tryFetch(sitemapUrl, 0);
  if (!content) return [];

  const locRegex = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/g;
  const urls: string[] = [];
  let match;
  while ((match = locRegex.exec(content)) !== null && urls.length < 500) {
    const url = match[1]?.trim();
    if (url && /\/(docs?|guide|api|reference|learn|tutorial)\//i.test(url)) {
      urls.push(url);
    }
  }

  if (urls.length > 0) {
    docCache.set(cacheKey, JSON.stringify(urls), CACHE_TTLS.SITEMAP);
    void diskDocCache.set(cacheKey, JSON.stringify(urls), CACHE_TTLS.SITEMAP);
  }

  return urls;
}

/** Query PyPI for package metadata */
export async function fetchPypiPackage(packageName: string): Promise<unknown> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
  const cacheKey = `pypi:${packageName}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) return JSON.parse(memCached) as unknown;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return JSON.parse(diskCached) as unknown;
  }

  const content = await tryFetch(url);
  if (!content) return null;

  try {
    const data = JSON.parse(content);
    docCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    void diskDocCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    return data as unknown;
  } catch {
    return null;
  }
}
