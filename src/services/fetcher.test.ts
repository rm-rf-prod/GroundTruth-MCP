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

describe("fetchWithTimeout", () => {
  it("calls fetch with User-Agent header", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com/test");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringContaining("GroundTruth"),
    });
  });

  it("passes extra headers to fetch", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com", 5000, { "X-Custom": "value" });
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({ "X-Custom": "value" });
  });

  it("returns the fetch response", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("body content", 200));
    const res = await fetchWithTimeout("https://example.com");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body content");
  });

  it("calls fetch with AbortSignal", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com", 5000);
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).signal).toBeDefined();
  });

  it("uses the provided URL", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com/path?q=1");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.com/path?q=1");
  });
});

// ── hashContent ─────────────────────────────────────────────────────────────

describe("hashContent", () => {
  it("returns a 16-character hex string", () => {
    const hash = hashContent("test content");
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("returns deterministic hashes", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
  });

  it("returns different hashes for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

// ── fetchDocs contentHash ───────────────────────────────────────────────────

describe("fetchDocs contentHash", () => {
  it("includes contentHash and fetchedAt in response", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(LONG, 200));
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(() => new Date(result.fetchedAt!)).not.toThrow();
  });
});

// ── fetchViaJina ────────────────────────────────────────────────────────────
