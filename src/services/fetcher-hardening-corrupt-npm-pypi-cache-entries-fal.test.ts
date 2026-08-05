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

describe("HARDENING: corrupt npm/pypi cache entries fall through to network", () => {
  it("fetchNpmPackage: corrupt memory-cache JSON falls through to disk/network and returns fresh data", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("npm:corrupt-mem-pkg", "{not valid json");
    const fresh = {
      name: "corrupt-mem-pkg",
      description: "Freshly fetched package data replacing the corrupt memory cache entry, long enough to clear thresholds.",
    };
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(fresh)));
    const result = await fetchNpmPackage("corrupt-mem-pkg");
    expect(result).toMatchObject({ name: "corrupt-mem-pkg" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetchPypiPackage: corrupt disk-cache JSON falls through to network and returns fresh data", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    await disk.set("pypi:corrupt-disk-pkg", "{ this is not json }}}");
    const fresh = {
      info: {
        name: "corrupt-disk-pkg",
        summary: "Freshly fetched PyPI package data replacing the corrupt disk cache entry, long enough to clear thresholds.",
      },
    };
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(fresh)));
    const result = await fetchPypiPackage("corrupt-disk-pkg");
    expect(result).toMatchObject({ info: { name: "corrupt-disk-pkg" } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── HARDENING (e): fetchDocs cache hit reports the original sourceType ──────

describe("HARDENING: fetchDocs cache hit reports the original sourceType", () => {
  it("memory-cache hit reports the original 'jina' sourceType, not hardcoded llms-txt", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes(JINA_LONG + "cachehit"));
      return Promise.resolve(makeRes("", 404));
    });
    const first = await fetchDocs("https://example.com/jina-sourcetype-cache");
    expect(first.sourceType).toBe("jina");

    const second = await fetchDocs("https://example.com/jina-sourcetype-cache");
    expect(second.sourceType).toBe("jina");
    expect(second.content).toBe(first.content);
  });

  it("disk-cache hit reports the original 'direct' sourceType, not hardcoded llms-txt", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    await disk.set("docs:https://example.com/direct-disk-sourcetype", LONG);
    await disk.set("docs:https://example.com/direct-disk-sourcetype:sourceType", "direct");
    const result = await fetchDocs("https://example.com/direct-disk-sourcetype");
    expect(result.sourceType).toBe("direct");
    expect(result.content).toBe(LONG);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to llms-txt sourceType when the companion cache entry is missing (pre-fix cache)", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("docs:https://example.com/legacy-cache-no-companion", LONG);
    // Intentionally no ":sourceType" companion entry — simulates a cache
    // file written before this hardening change.
    const result = await fetchDocs("https://example.com/legacy-cache-no-companion");
    expect(result.sourceType).toBe("llms-txt");
    expect(result.content).toBe(LONG);
  });
});

// ── Per-host bulkhead ───────────────────────────────────────────────────────
