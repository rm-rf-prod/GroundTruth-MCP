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

describe("HARDENING: fetchViaJina rejects oversized response bodies", () => {
  it("returns null when the response declares Content-Length over the 5MB cap", async () => {
    mockFetch.mockResolvedValueOnce(
      makeStreamRes([new TextEncoder().encode("small body")], {
        headers: { "content-length": String(6 * 1024 * 1024) },
      }),
    );
    const result = await fetchViaJina("https://example.com/jina-oversized-declared");
    expect(result).toBeNull();
  });

  it("returns null when the response streams over 5MB without a declared Content-Length", async () => {
    const chunk = new Uint8Array(3 * 1024 * 1024).fill(120); // 3MB of 'x'
    mockFetch.mockResolvedValueOnce(makeStreamRes([chunk, chunk])); // 6MB total
    const result = await fetchViaJina("https://example.com/jina-oversized-streamed");
    expect(result).toBeNull();
  });
});

// ── HARDENING (c): tryFetch records a circuit-breaker failure on short bodies ─
// tryFetch itself is private — driven here via fetchNpmPackage. Default
// CIRCUIT_BREAKER_THRESHOLD is 3 (src/config.ts): 3 short-body "successes"
// (<=50 chars) must open the circuit for the domain, so a subsequent call
// short-circuits to null WITHOUT calling fetch again.

describe("HARDENING: tryFetch short-body responses open the circuit breaker", () => {
  // A 200 with a tiny body is a healthy server serving a thin page (docs.astro.build
  // answers 80 bytes), not a failing upstream. Counting it against the breaker
  // blocked whole domains; the branch must still RESOLVE the breaker so a
  // half-open probe landing here cannot wedge it.
  it("does not open the circuit on repeated short-body responses", async () => {
    mockFetch.mockResolvedValue(makeRes("short", 200)); // 5 chars, always under the 50-char floor
    await fetchNpmPackage("short-body-pkg-1");
    await fetchNpmPackage("short-body-pkg-2");
    await fetchNpmPackage("short-body-pkg-3");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const result = await fetchNpmPackage("short-body-pkg-4");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(4); // circuit still closed — request went out
  });

  it("does not open the circuit on repeated 404s (auto-discovery probes)", async () => {
    mockFetch.mockResolvedValue(makeRes("not found", 404));
    await fetchNpmPackage("missing-pkg-1");
    await fetchNpmPackage("missing-pkg-2");
    await fetchNpmPackage("missing-pkg-3");
    const result = await fetchNpmPackage("missing-pkg-4");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("serves a repeated 404 URL from the negative cache without a second request", async () => {
    mockFetch.mockResolvedValue(makeRes("not found", 404));
    await fetchNpmPackage("gone-pkg");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { docCache, diskDocCache } = await import("./cache.js");
    docCache.clear();
    (diskDocCache as { clear: () => void }).clear();
    await fetchNpmPackage("gone-pkg");
    expect(mockFetch).toHaveBeenCalledTimes(1); // negative cache hit — no new network call
  });
});

// ── HARDENING (d): corrupt npm/pypi cache entries fall through to network ────
