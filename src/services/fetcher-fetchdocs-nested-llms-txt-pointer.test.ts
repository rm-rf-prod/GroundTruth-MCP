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

describe("fetchDocs nested llms.txt pointer", () => {
  const POINTER = [
    "# Next.js",
    "",
    "> The React Framework for the Web",
    "",
    "For comprehensive documentation see the index:",
    "",
    "- [Documentation Index](https://example.com/docs/llms.txt): Complete docs for LLMs",
    "- [Full Documentation](https://example.com/docs/llms-full.txt): Everything",
    "",
  ].join("\n");
  const NESTED = "- [Guide A](https://example.com/docs/a)\n".repeat(30);

  it("follows a pointer llms.txt one hop to the real index", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u === "https://example.com/llms.txt") return Promise.resolve(makeRes(POINTER));
      if (u === "https://example.com/docs/llms.txt") return Promise.resolve(makeRes(NESTED));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.url).toBe("https://example.com/docs/llms.txt");
    expect(result.content).toBe(NESTED);
  });

  it("keeps the original when the nested index is smaller or missing", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u === "https://example.com/llms.txt") return Promise.resolve(makeRes(POINTER));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.url).toBe("https://example.com/llms.txt");
    expect(result.content).toBe(POINTER);
  });

  it("never hops cross-host", async () => {
    const evil = POINTER.replace(/https:\/\/example\.com\/docs\/llms\.txt/g, "https://evil.example.net/llms.txt");
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u === "https://example.com/llms.txt") return Promise.resolve(makeRes(evil));
      if (u.includes("evil")) return Promise.resolve(makeRes("- [x](https://evil.example.net/a)\n".repeat(50)));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.url).toBe("https://example.com/llms.txt");
  });
});

describe("relative links in index handling", () => {
  const RELATIVE_INDEX = [
    "# Zustand",
    "",
    "- [Updating state](/learn/guides/updating-state)",
    "- [persist](/reference/middlewares/persist): How to persist a store",
    "- [devtools](/reference/middlewares/devtools)",
    "- [create](/reference/apis/create)",
    "- [useStore](/reference/hooks/use-store)",
    "- [Testing](/learn/guides/testing)",
  ].join("\n");

  it("isIndexContent recognizes relative-link TOCs", () => {
    expect(isIndexContent(RELATIVE_INDEX)).toBe(true);
  });

  it("rankIndexLinks resolves relative links against baseUrl", () => {
    const ranked = rankIndexLinks(RELATIVE_INDEX, "persist middleware", "https://zustand.docs.pmnd.rs/llms.txt");
    expect(ranked[0]).toBe("https://zustand.docs.pmnd.rs/reference/middlewares/persist");
  });

  it("rankIndexLinks skips relative links when no baseUrl is provided", () => {
    const ranked = rankIndexLinks(RELATIVE_INDEX, "persist middleware");
    expect(ranked).toEqual([]);
  });
});
