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

describe("rankIndexLinks", () => {
  it("ranks links by topic relevance", () => {
    const content = "- [Authentication Guide](https://example.com/auth)\n- [Routing](https://example.com/routing)\n- [Caching](https://example.com/cache)";
    const result = rankIndexLinks(content, "authentication");
    expect(result[0]).toBe("https://example.com/auth");
  });

  it("returns top 5 links when no topic matches", () => {
    const content = "- [A](https://a.com)\n- [B](https://b.com)\n- [C](https://c.com)\n- [D](https://d.com)\n- [E](https://e.com)\n- [F](https://f.com)";
    const result = rankIndexLinks(content, "");
    expect(result).toHaveLength(5);
  });

  it("returns empty array for content with no links", () => {
    expect(rankIndexLinks("no links here", "auth")).toEqual([]);
  });
});

// ── fetchDevDocs ─────────────────────────────────────────────────────────────

describe("fetchDevDocs", () => {
  it("fetches docs via Jina for a known slug", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG, 200));
    const result = await fetchDevDocs("python", "async");
    expect(result).not.toBeNull();
  });

  it("returns null when Jina returns short content", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("short", 200));
    const result = await fetchDevDocs("python");
    expect(result).toBeNull();
  });
});

// ── fetchDocs contentHash — additional paths ─────────────────────────────────

describe("fetchDocs contentHash — additional paths", () => {
  it("memory cache path: includes contentHash and fetchedAt", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("docs:https://example.com/mem-hash", LONG);
    const result = await fetchDocs("https://example.com/mem-hash");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(() => new Date(result.fetchedAt!)).not.toThrow();
  });

  it("Jina fallback path: includes contentHash and fetchedAt", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes(JINA_LONG + "jinahash"));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/jina-hash-path");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(result.sourceType).toBe("jina");
  });

  it("direct fetch path: includes contentHash and fetchedAt", async () => {
    const directContent = LONG + "directhash";
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes("short", 200));
      if (u === "https://example.com/direct-hash-path") return Promise.resolve(makeRes(directContent));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/direct-hash-path");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(result.sourceType).toBe("direct");
  });
});

// ── isBlockedIP (SSRF protection) ────────────────────────────────────────────
