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

describe("fetchGitHubExamples", () => {
  it("returns null for non-GitHub URLs", async () => {
    const result = await fetchGitHubExamples("https://example.com/repo");
    expect(result).toBeNull();
  });

  it("returns first matching path content with prefix header", async () => {
    const changelogContent = "x".repeat(400);
    mockFetch.mockResolvedValueOnce(makeRes(changelogContent));
    const result = await fetchGitHubExamples("https://github.com/org/examples-repo");
    expect(result).not.toBeNull();
    expect(result).toContain("GitHub");
    expect(result).toContain(changelogContent.slice(0, 4000));
  });

  it("returns null when no path has content > 300 chars", async () => {
    mockFetch.mockResolvedValue(makeRes("short", 200));
    const result = await fetchGitHubExamples("https://github.com/org/empty-repo");
    expect(result).toBeNull();
  });

  it("returns null when all fetches fail (404)", async () => {
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchGitHubExamples("https://github.com/org/no-docs");
    expect(result).toBeNull();
  });

  it("serves memory cache on repeated calls", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("x".repeat(500)));
    const r1 = await fetchGitHubExamples("https://github.com/org/examples-cached");
    const r2 = await fetchGitHubExamples("https://github.com/org/examples-cached");
    expect(r1).toBe(r2);
    // Batched in groups of 6 — first successful batch returns early; second call hits cache
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it("serves disk cache hit: warms memory cache and returns without fetching", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    const cachedExamples = "GitHub examples content from disk cache.\n".repeat(10);
    await disk.set("gh-examples:org/disk-examples-repo", cachedExamples);
    const result = await fetchGitHubExamples("https://github.com/org/disk-examples-repo");
    expect(result).toBe(cachedExamples);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── fetchNpmPackage ─────────────────────────────────────────────────────────
