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

describe("fetchSitemapUrls path-scoped discovery", () => {
  it("tries the project-path sitemap before the domain root", async () => {
    const XML = "<urlset><url><loc>https://docs.example.com/proj/docs/core/useThing</loc></url></urlset>";
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u === "https://docs.example.com/proj/sitemap.xml") return Promise.resolve(makeRes(XML));
      return Promise.resolve(makeRes("", 404));
    });
    const urls = await fetchSitemapUrls("https://docs.example.com/proj/docs/fundamentals/getting-started");
    expect(urls).toEqual(["https://docs.example.com/proj/docs/core/useThing"]);
    const firstUrl = mockFetch.mock.calls[0]?.[0]?.toString();
    expect(firstUrl).toBe("https://docs.example.com/proj/sitemap.xml");
  });

  it("falls back to the root sitemap when the scoped one is missing", async () => {
    const XML = "<urlset><url><loc>https://docs.example.com/docs/guide</loc></url></urlset>";
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u === "https://docs.example.com/sitemap.xml") return Promise.resolve(makeRes(XML));
      return Promise.resolve(makeRes("", 404));
    });
    const urls = await fetchSitemapUrls("https://docs.example.com/proj/docs/start");
    expect(urls).toEqual(["https://docs.example.com/docs/guide"]);
  });
});

// ── Content quality gate sub-detectors (garbage detection hardening) ────────

describe("isCloudflareChallenge", () => {
  it("detects a Cloudflare browser challenge page", () => {
    const content = "Checking your browser before accessing example.com.\n\nRay ID: 7f3a9c2b1e4d5678\n\nThis process is automatic. Please wait...";
    expect(isCloudflareChallenge(content)).toBe(true);
  });
});

describe("isRateLimitPage", () => {
  it("detects a rate-limit response rendered as content", () => {
    const content = "Rate limit exceeded. Please try again later.";
    expect(isRateLimitPage(content)).toBe(true);
  });
});

describe("isLoginWall", () => {
  it("detects a login wall on short content (under the 1000-char length gate)", () => {
    const content = "Please sign in to continue reading this article.";
    expect(content.length).toBeLessThan(1000);
    expect(isLoginWall(content)).toBe(true);
  });

  it("does not flag the same phrase once the document is >=1000 chars (length gate)", () => {
    const phrase = "You must be logged in to view this content.";
    const content = phrase + " " + "Additional real documentation text explaining various API endpoints and usage patterns in detail. ".repeat(20);
    expect(content.length).toBeGreaterThanOrEqual(1000);
    expect(isLoginWall(content)).toBe(false);
  });
});

describe("isMarketingPage", () => {
  it("returns false when a code fence is present, even with 2+ marketing signal words", () => {
    const content = "```js\nconst x = 1;\n```\n" +
      "Start your free trial today. Book a demo with our team. Trusted by thousands of companies. ".repeat(6);
    expect(content.length).toBeGreaterThanOrEqual(500);
    expect(isMarketingPage(content)).toBe(false);
  });

  it("returns true for a >=500-char marketing page without code fences", () => {
    const content = "Start your free trial today and see the difference. Book a demo with our sales team now. " +
      "Trusted by thousands of companies worldwide. Check out our enterprise plan and simple pricing options. ".repeat(4);
    expect(content.length).toBeGreaterThanOrEqual(500);
    expect(content).not.toContain("```");
    expect(isMarketingPage(content)).toBe(true);
  });
});
