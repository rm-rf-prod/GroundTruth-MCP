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

describe("fetchViaJina", () => {
  it("returns content from a successful Jina request", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG, 200));
    const result = await fetchViaJina("https://example.com/docs");
    expect(result).toBe(JINA_LONG);
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain("r.jina.ai");
    expect(url).toContain("https://example.com/docs");
  });

  it("sends X-Return-Format: markdown header", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG));
    await fetchViaJina("https://example.com/page");
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({ "X-Return-Format": "markdown" });
  });

  it("returns null when content is shorter than 200 chars", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("short", 200));
    const result = await fetchViaJina("https://example.com/short");
    expect(result).toBeNull();
  });

  it("returns null on non-OK status", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 404));
    const result = await fetchViaJina("https://example.com/notfound");
    expect(result).toBeNull();
  });

  it("rejects Jina-rendered 404 pages instead of returning them as content", async () => {
    // Jina returns HTTP 200 for pages whose TARGET returned 404 — the body carries
    // a warning marker plus the rendered error page. This must never become "content".
    const jina404 = [
      "Title: Next.js by Vercel - The React Framework",
      "",
      "URL Source: https://nextjs.org/docs/guides/performance",
      "",
      "Warning: Target URL returned error 404: Not Found",
      "",
      "Markdown Content:",
      "[nav](https://nextjs.org/)".repeat(60),
      "",
      "# 404",
      "",
      "## This page could not be found.",
      "",
      "[footer](https://vercel.com/legal)".repeat(60),
    ].join("\n");
    mockFetch.mockResolvedValue(makeRes(jina404, 200));
    const result = await fetchViaJina("https://nextjs.org/docs/guides/performance");
    expect(result).toBeNull();
  });

  it("does not cache rejected garbage (next call re-fetches)", async () => {
    const jina404 = `Warning: Target URL returned error 404: Not Found\n\n${"junk ".repeat(100)}`;
    mockFetch.mockResolvedValue(makeRes(jina404, 200));
    await fetchViaJina("https://example.com/dead");
    const callsAfterFirst = mockFetch.mock.calls.length;
    await fetchViaJina("https://example.com/dead");
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("returns null on 503 after two attempts", async () => {
    mockFetch
      .mockResolvedValueOnce(makeRes("", 503))
      .mockResolvedValueOnce(makeRes("", 503));
    const result = await fetchViaJina("https://example.com/down");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

});
