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

describe("isBlockedIP", () => {
  it.each([
    { ip: "127.0.0.1", expected: true },
    { ip: "127.0.0.2", expected: true },
    { ip: "10.0.0.1", expected: true },
    { ip: "172.16.0.1", expected: true },
    { ip: "172.31.255.255", expected: true },
    { ip: "192.168.1.1", expected: true },
    { ip: "169.254.0.1", expected: true },
    { ip: "0.0.0.0", expected: true },
    { ip: "225.2.0.1", expected: true },
    { ip: "::1", expected: true },
    { ip: "::", expected: true },
    { ip: "fc00::1", expected: true },
    { ip: "fd00::1", expected: true },
    { ip: "fe80::1", expected: true },
    { ip: "ff02::1", expected: true },
    { ip: "::ffff:127.0.0.1", expected: true },
  ])("blocks private IP $ip", ({ ip, expected }) => {
    expect(isBlockedIP(ip)).toBe(expected);
  });

  it.each([
    { ip: "8.8.8.8", expected: false },
    { ip: "104.26.11.242", expected: false },
    { ip: "172.67.70.54", expected: false },
    { ip: "216.230.84.129", expected: false },
    { ip: "185.199.109.133", expected: false },
    { ip: "76.76.21.123", expected: false },
  ])("allows public IP $ip", ({ ip, expected }) => {
    expect(isBlockedIP(ip)).toBe(expected);
  });

  it.each([
    { ip: "2606:4700:20::681a:af2", expected: false },
    { ip: "2606:50c0:8000::154", expected: false },
  ])("allows public IPv6 $ip", ({ ip, expected }) => {
    expect(isBlockedIP(ip)).toBe(expected);
  });

  it("blocks non-IP strings", () => {
    expect(isBlockedIP("not-an-ip")).toBe(true);
  });
});

// ── isHtmlBlob (HTML blob detection) ─────────────────────────────────────────
