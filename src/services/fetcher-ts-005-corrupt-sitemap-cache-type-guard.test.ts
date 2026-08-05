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

describe("TS-005: corrupt sitemap cache type guard", () => {
  it("returns [] when cached value is JSON null", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("sitemap:https://example.com", JSON.stringify(null));
    // Fetch should not be called — corrupt cache falls through to re-fetch,
    // which returns 404 → empty array.
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchSitemapUrls("https://example.com/docs");
    expect(result).toEqual([]);
  });

  it("returns [] when cached value is a JSON number", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("sitemap:https://example.com", JSON.stringify(42));
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchSitemapUrls("https://example.com/docs");
    expect(result).toEqual([]);
  });

  it("returns [] when cached value is a JSON object (not array)", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("sitemap:https://example.com", JSON.stringify({ urls: [] }));
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchSitemapUrls("https://example.com/docs");
    expect(result).toEqual([]);
  });

  it("returns [] when cached value is a mixed array (contains non-strings)", async () => {
    const { docCache } = await import("./cache.js");
    // Array with a number in it — passes Array.isArray but fails every() type guard.
    docCache.set("sitemap:https://example.com", JSON.stringify(["https://example.com/docs", 42]));
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchSitemapUrls("https://example.com/docs");
    expect(result).toEqual([]);
  });

  it("returns correct URLs when cache is a valid string[]", async () => {
    const { docCache } = await import("./cache.js");
    const urls = ["https://example.com/docs/guide", "https://example.com/docs/api"];
    docCache.set("sitemap:https://example.com:docs", JSON.stringify(urls));
    const result = await fetchSitemapUrls("https://example.com/docs");
    expect(result).toEqual(urls);
    // Cache hit — no network request needed.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("docsifyToRaw", () => {
  it("rewrites a docsify hash route to the raw markdown path", async () => {
    const { docsifyToRaw } = await import("./fetcher.js");
    expect(docsifyToRaw("https://getpino.io/#/docs/web")).toBe("https://getpino.io/docs/web.md");
  });

  it("preserves a base path before the hash", async () => {
    const { docsifyToRaw } = await import("./fetcher.js");
    expect(docsifyToRaw("https://site.dev/docs/#/guide/setup")).toBe("https://site.dev/docs/guide/setup.md");
  });

  it("keeps an explicit .md extension", async () => {
    const { docsifyToRaw } = await import("./fetcher.js");
    expect(docsifyToRaw("https://site.dev/#/README.md")).toBe("https://site.dev/README.md");
  });

  it("strips query strings and trailing slashes from the fragment", async () => {
    const { docsifyToRaw } = await import("./fetcher.js");
    expect(docsifyToRaw("https://site.dev/#/docs/web/?id=intro")).toBe("https://site.dev/docs/web.md");
  });

  it("returns null for non-hash URLs and empty fragments", async () => {
    const { docsifyToRaw } = await import("./fetcher.js");
    expect(docsifyToRaw("https://example.com/docs/web")).toBeNull();
    expect(docsifyToRaw("https://example.com/#/")).toBeNull();
    expect(docsifyToRaw("not a url")).toBeNull();
  });
});

// ── isErrorPage — long 404s and Jina warning markers ────────────────────────
