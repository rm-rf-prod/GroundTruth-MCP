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
  it("returns null for non-GitHub URLs", async () => {
    const result = await fetchGitHubReleases("https://gitlab.com/org/repo");
    expect(result).toBeNull();
  });

  it("returns null on 403 (rate limit)", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 403));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("returns null on 429 (explicit rate limit)", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 429));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("returns null on non-ok status", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 500));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("returns null when releases array is empty", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify([])));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("formats release notes from API response", async () => {
    const releases = [
      { tag_name: "v1.0.0", body: "Initial release", published_at: "2024-01-15T00:00:00Z", prerelease: false },
      { tag_name: "v0.9.0", body: "Beta release", published_at: "2024-01-01T00:00:00Z", prerelease: false },
    ];
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(releases)));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).not.toBeNull();
    expect(result).toContain("v1.0.0");
    expect(result).toContain("Initial release");
    expect(result).toContain("2024-01-15");
  });

  it("skips prerelease versions", async () => {
    const releases = [
      { tag_name: "v2.0.1-beta", body: "Beta", published_at: "2024-02-01T00:00:00Z", prerelease: true },
      { tag_name: "v1.0.0", body: "Stable", published_at: "2024-01-01T00:00:00Z", prerelease: false },
    ];
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(releases)));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).not.toContain("v2.0.1-beta");
    expect(result).toContain("v1.0.0");
  });

  it("uses GT_GITHUB_TOKEN for Authorization header when set", async () => {
    process.env.GT_GITHUB_TOKEN = "test-token-abc";
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify([
      { tag_name: "v1.0.0", body: "Release", published_at: "2024-01-01T00:00:00Z", prerelease: false },
    ])));
    await fetchGitHubReleases("https://github.com/org/repo");
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-token-abc" });
    delete process.env.GT_GITHUB_TOKEN;
  });

  it("strips .git suffix from repo URL", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify([
      { tag_name: "v1.0.0", published_at: "2024-01-01T00:00:00Z", prerelease: false },
    ])));
    await fetchGitHubReleases("https://github.com/org/repo.git");
    const [url] = mockFetch.mock.calls[0]!;
    // Check repo path has no .git suffix (note: api.github.com itself contains ".git" as substring)
    expect(url.toString()).not.toContain("repo.git");
    expect(url.toString()).toContain("org/repo");
  });

});
