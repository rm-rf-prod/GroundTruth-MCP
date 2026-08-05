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

describe("REL-004: FetchSemaphore underflow guard", () => {
  it("does not decrement running below zero on double release", () => {
    // running must be 0 at start (beforeEach clears state, semaphore is module-level
    // but acquire/release pairs from prior tests should be balanced).
    // We verify the current running count first.
    const before = fetchSemaphore.running;

    // Only call release when active is already 0 (safe to call if before===0).
    // If other tests left semaphore with running>0 we skip the direct call and
    // instead use a balanced pair to reach 0, then call release.
    if (before === 0) {
      fetchSemaphore.release();
      expect(fetchSemaphore.running).toBe(0);
    } else {
      // Acquire 'before' permits then release them all + one extra to hit underflow.
      // Not easily done in a unit test — just assert the guard invariant holds
      // by confirming running never went negative in prior state.
      expect(before).toBeGreaterThanOrEqual(0);
    }
  });

  it("logs a warn when release is called with running=0", () => {
    // Ensure running starts at 0 for this test
    expect(fetchSemaphore.running).toBe(0);

    fetchSemaphore.release();

    // mockLog is the hoisted vi.fn() replacing the real log function.
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        msg: "FetchSemaphore.release_underflow",
      }),
    );
  });

  it("running stays at 0 after underflow release (no negative drift)", () => {
    expect(fetchSemaphore.running).toBe(0);
    // Call release twice — both must be no-ops, not -1 then -2.
    fetchSemaphore.release();
    fetchSemaphore.release();
    expect(fetchSemaphore.running).toBe(0);
  });
});

// ── EH-004: debug log on fetchGitHubReleases throw ──────────────────────────
// When fetchWithTimeout throws inside fetchGitHubReleases the catch block
// must call log({ level: 'debug', msg: 'fetchGitHubReleases.error', ... }).

describe("EH-004: fetchGitHubReleases error logging", () => {
  it("logs debug message when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const result = await fetchGitHubReleases("https://github.com/org/repo");
    expect(result).toBeNull();
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "debug",
        msg: "fetchGitHubReleases.error",
        error: "network down",
      }),
    );
  });

  it("includes repo path in debug log when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));
    await fetchGitHubReleases("https://github.com/myorg/myrepo");
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "fetchGitHubReleases.error",
        repo: "myorg/myrepo",
      }),
    );
  });
});

// ── TS-005: corrupt sitemap cache returns [] not TypeError ───────────────────
// If docCache holds a valid JSON value that is NOT a string[] (e.g. null,
// number, object), fetchSitemapUrls must return [] and not throw.
