import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchWithTimeout,
  fetchViaJina,
  fetchDocs,
  fetchAsMarkdownRace,
  fetchGitHubContent,
  fetchGitHubReleases,
  fetchGitHubExamples,
  fetchNpmPackage,
  fetchPypiPackage,
  fetchDevDocs,
  fetchSitemapUrls,
  fetchSemaphore,
  hashContent,
  isIndexContent,
  rankIndexLinks,
  isBlockedIP,
  isHtmlBlob,
  isErrorPage,
  isGarbageContent,
  isLoginWall,
  isCloudflareChallenge,
  isRateLimitPage,
  isMarketingPage,
  isEmptySPAShell,
  clearNegativeCache,
} from "./fetcher.js";
import { resetAllCircuits } from "./circuit-breaker.js";

// ── Logger mock ─────────────────────────────────────────────────────────────
// Hoisted so ESM import of fetcher.ts sees the mock before it loads logger.js.

const mockLog = vi.hoisted(() => vi.fn());

vi.mock("../utils/logger.js", () => ({
  log: mockLog,
}));

// ── Cache mock ──────────────────────────────────────────────────────────────
// Factory is self-contained so vi.mock hoisting works correctly in ESM.

vi.mock("./cache.js", () => {
  const memStore = new Map<string, string>();
  const diskStore = new Map<string, string>();
  return {
    docCache: {
      get: (k: string) => memStore.get(k),
      set: (k: string, v: string, _ttl?: number) => { memStore.set(k, v); },
      clear: () => { memStore.clear(); },
      has: (k: string) => memStore.has(k),
      delete: (k: string) => { memStore.delete(k); },
      size: () => memStore.size,
    },
    diskDocCache: {
      get: async (k: string) => diskStore.get(k),
      set: async (k: string, v: string, _ttl?: number) => { diskStore.set(k, v); },
      clear: () => { diskStore.clear(); },
    },
    resolveCache: {
      get: () => undefined,
      set: () => {},
      clear: () => {},
    },
  };
});

// ── Fetch mock ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn<typeof fetch>();

function makeRes(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as Response;
}

const LONG = "x".repeat(200); // >100 chars — passes tryFetch threshold
const JINA_LONG = "y".repeat(300); // >200 chars — passes fetchViaJina threshold

/**
 * Build a real fetch Response backed by a ReadableStream. makeRes-style plain
 * objects have no `.body` stream and bypass readBodyCapped's streaming logic
 * entirely (see fetcher.ts's early-return for bodyless responses) — these
 * tests need the real streaming path, so they use real Response/ReadableStream
 * instances instead. fetchWithTimeout wraps these in a pass-through stream,
 * which is transparent to callers.
 */
function makeStreamRes(
  chunks: Uint8Array[],
  opts: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: opts.status ?? 200, headers: opts.headers });
}

beforeEach(async () => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockLog.mockReset();
  // Clear both cache layers imported from mocked module
  const { docCache, diskDocCache } = await import("./cache.js");
  docCache.clear();
  (diskDocCache as { clear: () => void }).clear();
  // Unset GitHub token env to avoid auth headers in tests
  delete process.env.GT_GITHUB_TOKEN;
  resetAllCircuits();
  clearNegativeCache();
});

// ── fetchWithTimeout ────────────────────────────────────────────────────────

describe("fetchGitHubContent", () => {
  it("returns null for non-GitHub URLs", async () => {
    const result = await fetchGitHubContent("https://gitlab.com/org/repo");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches README from main branch", async () => {
    const readmeContent = LONG + "readme main";
    mockFetch.mockResolvedValueOnce(makeRes(readmeContent));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe(readmeContent);
    expect(result!.sourceType).toBe("github-readme");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("raw.githubusercontent.com");
    expect(url.toString()).toContain("org/repo");
    expect(url.toString()).toContain("main");
  });

  it("falls back to master branch when main fails", async () => {
    const readmeContent = LONG + "readme master";
    mockFetch
      .mockResolvedValueOnce(makeRes("", 404))
      .mockResolvedValueOnce(makeRes(readmeContent));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe(readmeContent);
    const [url] = mockFetch.mock.calls[1]!;
    expect(url.toString()).toContain("master");
  });

  it("returns null when both branches fail", async () => {
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("fetches a specific file path", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(LONG + "changelog"));
    const result = await fetchGitHubContent("https://github.com/org/repo", "CHANGELOG.md");
    expect(result).not.toBeNull();
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("CHANGELOG.md");
  });

  it("serves memory cache on second call", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(LONG + "cached"));
    const r1 = await fetchGitHubContent("https://github.com/org/cached-repo");
    const r2 = await fetchGitHubContent("https://github.com/org/cached-repo");
    expect(r1!.content).toBe(r2!.content);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when content is too short (<=100 chars)", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("short content"));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).toBeNull();
  });
});

// ── fetchGitHubReleases ─────────────────────────────────────────────────────
