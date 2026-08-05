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

describe("isEmptySPAShell", () => {
  it("detects an unrendered SPA shell (empty root div)", () => {
    const shell = '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>';
    expect(isEmptySPAShell(shell)).toBe(true);
  });

  it("returns false when real content has rendered inside the root div", () => {
    const rendered = `<html><body><div id="root"><p>${"Real rendered documentation content describing the API in detail. ".repeat(5)}</p></div></body></html>`;
    expect(isEmptySPAShell(rendered)).toBe(false);
  });
});

describe("isGarbageContent", () => {
  it("returns {garbage: false} for a normal documentation page", () => {
    const content = [
      "# Getting Started",
      "",
      "This is a comprehensive guide explaining how to install and configure the library correctly.",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "## Advanced Usage",
      "",
      "More real explanatory text here describing configuration options and typical usage patterns in depth.",
    ].join("\n");
    expect(isGarbageContent(content)).toEqual({ garbage: false, reason: "" });
  });
});

// ── fetchAsMarkdownRace ──────────────────────────────────────────────────────

describe("fetchAsMarkdownRace", () => {
  const RACE_CLEAN_TEXT = "Plain text documentation content without any html tags present in this response body at all. ".repeat(3); // >100 chars, 0% tag density
  const RACE_RAW_MD = "# Docs A\n\nReal markdown content describing feature A in detail so the raw docsify markdown clears the 200-char floor and content-quality gate. ".repeat(2); // >=200 chars, non-garbage

  it("returns clean low-tag-density direct-fetch text for a non-docsify URL", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes("", 404)); // jina target fails
      return Promise.resolve(makeRes(RACE_CLEAN_TEXT, 200));
    });
    const result = await fetchAsMarkdownRace("https://example.com/race-direct");
    expect(result).toBe(RACE_CLEAN_TEXT);
  });

  it("returns raw .md content for a docsify hash-route URL", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes("", 404)); // jina fails — only the raw path can win
      if (u === "https://x.io/docs/a.md") return Promise.resolve(makeRes(RACE_RAW_MD, 200));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchAsMarkdownRace("https://x.io/#/docs/a");
    expect(result).toBe(RACE_RAW_MD);
  });

  it("returns null when every arm (docsify raw / direct / jina) fails", async () => {
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchAsMarkdownRace("https://example.com/race-all-fail");
    expect(result).toBeNull();
  });
});

// ── readBodyCapped 5MB cap enforcement (HARDENING) ───────────────────────────
// readBodyCapped itself is not exported — exercised indirectly via
// fetchNpmPackage, which is the simplest exported caller that funnels through
// tryFetch → readBodyCapped.
