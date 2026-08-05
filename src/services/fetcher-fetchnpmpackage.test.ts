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

describe("fetchNpmPackage", () => {
  it("returns parsed JSON from npm registry", async () => {
    // Body must be > 100 chars to pass tryFetch threshold
    const pkg = { name: "my-package", description: "A test package for the npm registry with enough content to exceed the 100 character minimum threshold", version: "1.0.0" };
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(pkg)));
    const result = await fetchNpmPackage("my-package");
    expect(result).toMatchObject({ name: "my-package", description: expect.stringContaining("A test package") });
  });

  it("encodes package name in URL", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify({ name: "@scope/pkg" })));
    await fetchNpmPackage("@scope/pkg");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("registry.npmjs.org");
    expect(url.toString()).toContain(encodeURIComponent("@scope/pkg"));
  });

  it("returns null when fetch returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 404));
    const result = await fetchNpmPackage("nonexistent-pkg");
    expect(result).toBeNull();
  });

  it("returns null when response body is invalid JSON", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("not-json".padEnd(150, "x")));
    const result = await fetchNpmPackage("bad-json-pkg");
    expect(result).toBeNull();
  });

  it("returns null when content is too short (<=100 chars)", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("{}"));
    const result = await fetchNpmPackage("short-pkg");
    expect(result).toBeNull();
  });

  it("serves memory cache on second call", async () => {
    const pkg = { name: "cached-pkg", description: "Cached" };
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(pkg).padEnd(200, " ")));
    const r1 = await fetchNpmPackage("cached-pkg");
    const r2 = await fetchNpmPackage("cached-pkg");
    expect(r1).toMatchObject({ name: "cached-pkg" });
    expect(r2).toMatchObject({ name: "cached-pkg" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("serves disk cache before making network request", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    const pkg = { name: "disk-pkg", description: "From disk" };
    await disk.set("npm:disk-cached-pkg", JSON.stringify(pkg).padEnd(200, " "));
    const result = await fetchNpmPackage("disk-cached-pkg");
    expect(result).toMatchObject({ name: "disk-pkg" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── fetchPypiPackage ────────────────────────────────────────────────────────
