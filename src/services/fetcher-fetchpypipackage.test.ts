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

describe("fetchPypiPackage", () => {
  it("returns parsed JSON from PyPI", async () => {
    // Body must be > 100 chars to pass tryFetch threshold
    const pkg = { info: { name: "my-lib", summary: "A Python library with detailed summary to exceed the 100 character minimum content length threshold", version: "0.1.0" } };
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(pkg)));
    const result = await fetchPypiPackage("my-lib");
    expect(result).toMatchObject({ info: { name: "my-lib" } });
  });

  it("builds the correct PyPI JSON URL", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify({ info: { name: "flask" } })));
    await fetchPypiPackage("flask");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toBe(`https://pypi.org/pypi/${encodeURIComponent("flask")}/json`);
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 404));
    const result = await fetchPypiPackage("nonexistent-pypi-pkg");
    expect(result).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("invalid-json".padEnd(150, "x")));
    const result = await fetchPypiPackage("bad-pkg");
    expect(result).toBeNull();
  });

  it("serves memory cache on second call", async () => {
    const pkg = { info: { name: "cached-pypi" } };
    mockFetch.mockResolvedValueOnce(makeRes(JSON.stringify(pkg).padEnd(200, " ")));
    const r1 = await fetchPypiPackage("cached-pypi");
    const r2 = await fetchPypiPackage("cached-pypi");
    expect(r1).toMatchObject({ info: { name: "cached-pypi" } });
    expect(r2).toMatchObject({ info: { name: "cached-pypi" } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("serves disk cache before network request", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    const pkg = { info: { name: "disk-pypi-pkg" } };
    await disk.set("pypi:disk-pypi-pkg", JSON.stringify(pkg).padEnd(200, " "));
    const result = await fetchPypiPackage("disk-pypi-pkg");
    expect(result).toMatchObject({ info: { name: "disk-pypi-pkg" } });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── isIndexContent ───────────────────────────────────────────────────────────

describe("isIndexContent", () => {
  it("returns true when >50% of lines are markdown links", () => {
    const content = [
      "# Index",
      "- [Getting Started](https://example.com/start)",
      "- [API Reference](https://example.com/api)",
      "- [Guide](https://example.com/guide)",
      "- [FAQ](https://example.com/faq)",
      "- [Support](https://example.com/support)",
    ].join("\n");
    expect(isIndexContent(content)).toBe(true);
  });

  it("returns false for normal documentation content", () => {
    const content = "# Guide\n\nThis is a guide about using the library.\n\nIt has multiple paragraphs of content.\n\nWith code examples and explanations.";
    expect(isIndexContent(content)).toBe(false);
  });

  it("returns false for content with fewer than 5 lines", () => {
    expect(isIndexContent("- [A](https://a.com)\n- [B](https://b.com)")).toBe(false);
  });
});

// ── rankIndexLinks ───────────────────────────────────────────────────────────
