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

describe("fetchDocs", () => {
  it("returns from memory cache without fetching", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("docs:https://example.com/docs", LONG);
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.content).toBe(LONG);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns from disk cache without fetching", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    await disk.set("docs:https://example.com/docs", LONG);
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.content).toBe(LONG);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns llms-full.txt content when available (preferred over llms.txt)", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("llms-full.txt")) return Promise.resolve(makeRes(LONG + "full"));
        if (u.includes("llms.txt")) return Promise.resolve(makeRes(LONG + "short"));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs(
      "https://example.com/docs",
      "https://example.com/llms.txt",
      "https://example.com/llms-full.txt",
    );
    expect(result.sourceType).toBe("llms-full-txt");
    expect(result.content).toBe(LONG + "full");
  });

  it("falls back to llms.txt when llms-full.txt is missing", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("llms-full.txt")) return Promise.resolve(makeRes("", 404));
        if (u.endsWith("llms.txt")) return Promise.resolve(makeRes(LONG + "txt"));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs(
      "https://example.com/docs",
      "https://example.com/llms.txt",
      "https://example.com/llms-full.txt",
    );
    expect(result.sourceType).toBe("llms-txt");
    expect(result.content).toBe(LONG + "txt");
  });

  it("auto-discovers llms.txt from docsUrl origin", async () => {
    const discovered = LONG + "discovered";
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u === "https://example.com/llms.txt") return Promise.resolve(makeRes(discovered));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs("https://example.com/docs");
    expect(result.sourceType).toBe("llms-txt");
    expect(result.content).toBe(discovered);
  });

  it("falls back to Jina when llms.txt discovery fails", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("r.jina.ai")) return Promise.resolve(makeRes(JINA_LONG + "jina"));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs("https://example.com/docs");
    expect(result.sourceType).toBe("jina");
    expect(result.content).toBe(JINA_LONG + "jina");
  });

});
