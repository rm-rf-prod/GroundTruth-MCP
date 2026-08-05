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

describe("fetchGitHubReleases", () => {
  it("serves memory cache on repeated calls", async () => {
    const releases = [{ tag_name: "v1.0.0", body: "Release", published_at: "2024-01-01T00:00:00Z", prerelease: false }];
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(releases)));
    const r1 = await fetchGitHubReleases("https://github.com/org/releases-cached");
    const r2 = await fetchGitHubReleases("https://github.com/org/releases-cached");
    expect(r1).toBe(r2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("serves disk cache hit: warms memory cache and returns without fetching", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    const cachedReleases = "## Recent Releases\n\n### v3.0.3\nCached from disk.\n";
    await disk.set("gh-releases:org/disk-releases-repo", cachedReleases);
    const result = await fetchGitHubReleases("https://github.com/org/disk-releases-repo");
    expect(result).toBe(cachedReleases);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Regression — v7.0.x: canary-heavy projects (Next.js) had top-3 releases all
  // prereleases. With per_page=3 + filter prereleases, result was empty → tool
  // returned "No changelog found". Fix: fetch 30, take first 3 stable.
  it("Bug C-1: picks stable releases even when top entries are canaries", async () => {
    const releases = [
      { tag_name: "v16.3.0-canary.30", body: "Canary", published_at: "2026-05-25T00:00:00Z", prerelease: true },
      { tag_name: "v16.3.0-canary.29", body: "Canary", published_at: "2026-05-24T00:00:00Z", prerelease: true },
      { tag_name: "v16.3.0-canary.28", body: "Canary", published_at: "2026-05-23T00:00:00Z", prerelease: true },
      { tag_name: "v16.2.0", body: "Stable 16.2", published_at: "2026-05-10T00:00:00Z", prerelease: false },
      { tag_name: "v16.1.5", body: "Stable 16.1.5", published_at: "2026-05-01T00:00:00Z", prerelease: false },
      { tag_name: "v16.1.4", body: "Stable 16.1.4", published_at: "2026-04-20T00:00:00Z", prerelease: false },
    ];
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(releases)));
    const result = await fetchGitHubReleases("https://github.com/vercel/next-fixture-1");
    expect(result).not.toBeNull();
    expect(result).toContain("v16.2.0");
    expect(result).toContain("v16.1.5");
    expect(result).toContain("v16.1.4");
    expect(result).not.toContain("canary");
  });

  it("Bug C-1: requests per_page=30 (not 3) to see past canary buffer", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify([
      { tag_name: "v1.0.0", body: "Release", published_at: "2024-01-01T00:00:00Z", prerelease: false },
    ])));
    await fetchGitHubReleases("https://github.com/org/per-page-fixture");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("per_page=30");
  });

  it("Bug C-1: falls back to including prereleases when no stable exists", async () => {
    const releases = [
      { tag_name: "v2.0.0-beta.5", body: "Beta 5", published_at: "2026-05-15T00:00:00Z", prerelease: true },
      { tag_name: "v2.0.0-beta.4", body: "Beta 4", published_at: "2026-05-10T00:00:00Z", prerelease: true },
      { tag_name: "v2.0.0-beta.3", body: "Beta 3", published_at: "2026-05-01T00:00:00Z", prerelease: true },
    ];
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(releases)));
    const result = await fetchGitHubReleases("https://github.com/org/canary-only-fixture");
    expect(result).not.toBeNull();
    expect(result).toContain("v2.0.0-beta.5");
    expect(result).toContain("(prerelease)");
  });

  it("Bug C-1: filters out drafts even when prerelease is false", async () => {
    const releases = [
      { tag_name: "v3.0.0", body: "Draft release", published_at: "2026-06-01T00:00:00Z", prerelease: false, draft: true },
      { tag_name: "v2.0.0", body: "Stable", published_at: "2026-05-01T00:00:00Z", prerelease: false, draft: false },
    ];
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(releases)));
    const result = await fetchGitHubReleases("https://github.com/org/draft-fixture");
    expect(result).toContain("v2.0.0");
    expect(result).not.toContain("v3.0.0");
  });
});
