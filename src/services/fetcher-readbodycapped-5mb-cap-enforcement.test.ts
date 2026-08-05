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

describe("readBodyCapped 5MB cap enforcement", () => {
  it("treats a declared Content-Length over 5MB as a fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(
      makeStreamRes([new TextEncoder().encode("small body")], {
        headers: { "content-length": String(6 * 1024 * 1024) },
      }),
    );
    const result = await fetchNpmPackage("cap-test-declared-oversized");
    expect(result).toBeNull();
  });

  it("aborts and treats an undeclared streaming body exceeding 5MB as a failure", async () => {
    const chunk = new Uint8Array(3 * 1024 * 1024).fill(97); // 3MB of 'a'
    mockFetch.mockResolvedValueOnce(makeStreamRes([chunk, chunk])); // 6MB total, no content-length header
    const result = await fetchNpmPackage("cap-test-streamed-oversized");
    expect(result).toBeNull();
  });

  it("succeeds for a normal small streamed body under the cap", async () => {
    const pkg = {
      name: "cap-test-small-body",
      description: "A small package body streamed through a real ReadableStream, long enough to clear the 50-char tryFetch threshold.",
    };
    mockFetch.mockResolvedValueOnce(makeStreamRes([new TextEncoder().encode(JSON.stringify(pkg))]));
    const result = await fetchNpmPackage("cap-test-small-body");
    expect(result).toMatchObject({ name: "cap-test-small-body" });
  });
});

// ── HARDENING (a): fetchWithTimeout slow-drip abort ──────────────────────────
// The abort timer must stay armed until the body stream fully drains, errors,
// or is cancelled — a body that delivers one chunk then hangs must still be
// aborted within the configured deadline instead of hanging forever.

describe("HARDENING: fetchWithTimeout slow-drip abort", () => {
  it("aborts a body stream that delivers one chunk then hangs, within the timeout budget", async () => {
    mockFetch.mockImplementation((_url: RequestInfo | URL, options?: RequestInit) => {
      const signal = options?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("chunk1"));
          // Never close — simulates an attacker holding the connection open
          // (slow-drip). Mirrors how a real HTTP client aborts an in-flight
          // response body: rejecting the pending read once the signal fires.
          signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    const result = await fetchWithTimeout("https://example.com/slow-drip", 100);
    const reader = result.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe("chunk1");

    // Second read hangs until the still-armed abort timer fires (~100ms),
    // then must reject rather than hang forever.
    await expect(reader.read()).rejects.toThrow();
  });
});

// ── HARDENING (b): fetchViaJina rejects oversized response bodies ───────────
