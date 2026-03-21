import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchWithTimeout,
  fetchViaJina,
  fetchDocs,
  fetchGitHubContent,
  fetchGitHubReleases,
  fetchGitHubExamples,
  fetchNpmPackage,
  fetchPypiPackage,
  fetchDevDocs,
  hashContent,
  isIndexContent,
  rankIndexLinks,
} from "./fetcher.js";
import { resetAllCircuits } from "./circuit-breaker.js";

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

beforeEach(async () => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  // Clear both cache layers imported from mocked module
  const { docCache, diskDocCache } = await import("./cache.js");
  docCache.clear();
  (diskDocCache as { clear: () => void }).clear();
  // Unset GitHub token env to avoid auth headers in tests
  delete process.env.GT_GITHUB_TOKEN;
  resetAllCircuits();
});

// ── fetchWithTimeout ────────────────────────────────────────────────────────

describe("fetchWithTimeout", () => {
  it("calls fetch with User-Agent header", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com/test");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringContaining("GroundTruth"),
    });
  });

  it("passes extra headers to fetch", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com", 5000, { "X-Custom": "value" });
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({ "X-Custom": "value" });
  });

  it("returns the fetch response", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("body content", 200));
    const res = await fetchWithTimeout("https://example.com");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body content");
  });

  it("calls fetch with AbortSignal", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com", 5000);
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).signal).toBeDefined();
  });

  it("uses the provided URL", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("ok"));
    await fetchWithTimeout("https://example.com/path?q=1");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.com/path?q=1");
  });
});

// ── hashContent ─────────────────────────────────────────────────────────────

describe("hashContent", () => {
  it("returns a 16-character hex string", () => {
    const hash = hashContent("test content");
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("returns deterministic hashes", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
  });

  it("returns different hashes for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

// ── fetchDocs contentHash ───────────────────────────────────────────────────

describe("fetchDocs contentHash", () => {
  it("includes contentHash and fetchedAt in response", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(LONG, 200));
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(() => new Date(result.fetchedAt!)).not.toThrow();
  });
});

// ── fetchViaJina ────────────────────────────────────────────────────────────

describe("fetchViaJina", () => {
  it("returns content from a successful Jina request", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG, 200));
    const result = await fetchViaJina("https://example.com/docs");
    expect(result).toBe(JINA_LONG);
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain("r.jina.ai");
    expect(url).toContain("https://example.com/docs");
  });

  it("sends X-Return-Format: markdown header", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG));
    await fetchViaJina("https://example.com/page");
    const [, options] = mockFetch.mock.calls[0]!;
    expect((options as RequestInit).headers).toMatchObject({ "X-Return-Format": "markdown" });
  });

  it("returns null when content is shorter than 200 chars", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("short", 200));
    const result = await fetchViaJina("https://example.com/short");
    expect(result).toBeNull();
  });

  it("returns null on non-OK status", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("", 404));
    const result = await fetchViaJina("https://example.com/notfound");
    expect(result).toBeNull();
  });

  it("returns null on 503 after two attempts", async () => {
    mockFetch
      .mockResolvedValueOnce(makeRes("", 503))
      .mockResolvedValueOnce(makeRes("", 503));
    const result = await fetchViaJina("https://example.com/down");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 and returns content on second attempt", async () => {
    mockFetch
      .mockResolvedValueOnce(makeRes("", 429))
      .mockResolvedValueOnce(makeRes(JINA_LONG, 200));
    const result = await fetchViaJina("https://example.com/rate-limited");
    expect(result).toBe(JINA_LONG);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("serves memory cache on repeated calls", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG, 200));
    const first = await fetchViaJina("https://example.com/cached");
    const second = await fetchViaJina("https://example.com/cached");
    expect(first).toBe(JINA_LONG);
    expect(second).toBe(JINA_LONG);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only one real request
  });

  it("serves disk cache before making a network request", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    await disk.set("jina:https://example.com/disk-cached", JINA_LONG);
    const result = await fetchViaJina("https://example.com/disk-cached");
    expect(result).toBe(JINA_LONG);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when fetch throws", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"));
    const result = await fetchViaJina("https://example.com/error");
    expect(result).toBeNull();
  });
});

// ── fetchDocs ───────────────────────────────────────────────────────────────

describe("fetchDocs", () => {
  it("returns from memory cache without fetching", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("docs:https://example.com/docs", LONG);
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.content).toBe(LONG);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns from disk cache without fetching", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    await disk.set("docs:https://example.com/docs", LONG);
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.content).toBe(LONG);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns llms-full.txt content when available (preferred over llms.txt)", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("llms-full.txt")) return Promise.resolve(makeRes(LONG + "full"));
        if (u.includes("llms.txt")) return Promise.resolve(makeRes(LONG + "short"));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs(
      "https://example.com/docs",
      "https://example.com/llms.txt",
      "https://example.com/llms-full.txt",
    );
    expect(result.sourceType).toBe("llms-full-txt");
    expect(result.content).toBe(LONG + "full");
  });

  it("falls back to llms.txt when llms-full.txt is missing", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("llms-full.txt")) return Promise.resolve(makeRes("", 404));
        if (u.endsWith("llms.txt")) return Promise.resolve(makeRes(LONG + "txt"));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs(
      "https://example.com/docs",
      "https://example.com/llms.txt",
      "https://example.com/llms-full.txt",
    );
    expect(result.sourceType).toBe("llms-txt");
    expect(result.content).toBe(LONG + "txt");
  });

  it("auto-discovers llms.txt from docsUrl origin", async () => {
    const discovered = LONG + "discovered";
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u === "https://example.com/llms.txt") return Promise.resolve(makeRes(discovered));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs("https://example.com/docs");
    expect(result.sourceType).toBe("llms-txt");
    expect(result.content).toBe(discovered);
  });

  it("falls back to Jina when llms.txt discovery fails", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("r.jina.ai")) return Promise.resolve(makeRes(JINA_LONG + "jina"));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs("https://example.com/docs");
    expect(result.sourceType).toBe("jina");
    expect(result.content).toBe(JINA_LONG + "jina");
  });

  it("falls back to direct fetch when Jina also fails", async () => {
    const directContent = LONG + "direct";
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes("r.jina.ai")) return Promise.resolve(makeRes("short", 200)); // <200 chars
        if (u === "https://example.com/docs") return Promise.resolve(makeRes(directContent));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs("https://example.com/docs");
    expect(result.sourceType).toBe("direct");
    expect(result.content).toBe(directContent);
  });

  it("throws when all fetch strategies fail", async () => {
    mockFetch.mockResolvedValue(makeRes("", 404));
    await expect(fetchDocs("https://example.com/docs")).rejects.toThrow(
      "Failed to fetch documentation",
    );
  });

  it("includes the resolved URL in the FetchResult", async () => {
    mockFetch
      .mockImplementation((url: RequestInfo | URL) => {
        const u = url.toString();
        if (u === "https://example.com/llms.txt") return Promise.resolve(makeRes(LONG));
        return Promise.resolve(makeRes("", 404));
      });
    const result = await fetchDocs("https://example.com/docs", "https://example.com/llms.txt");
    expect(result.url).toBeDefined();
    expect(result.url.length).toBeGreaterThan(0);
  });
});

// ── fetchGitHubContent ──────────────────────────────────────────────────────

describe("fetchGitHubContent", () => {
  it("returns null for non-GitHub URLs", async () => {
    const result = await fetchGitHubContent("https://gitlab.com/org/repo");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches README from main branch", async () => {
    const readmeContent = LONG + "readme main";
    mockFetch.mockResolvedValueOnce(makeRes(readmeContent));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe(readmeContent);
    expect(result!.sourceType).toBe("github-readme");
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("raw.githubusercontent.com");
    expect(url.toString()).toContain("org/repo");
    expect(url.toString()).toContain("main");
  });

  it("falls back to master branch when main fails", async () => {
    const readmeContent = LONG + "readme master";
    mockFetch
      .mockResolvedValueOnce(makeRes("", 404))
      .mockResolvedValueOnce(makeRes(readmeContent));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toBe(readmeContent);
    const [url] = mockFetch.mock.calls[1]!;
    expect(url.toString()).toContain("master");
  });

  it("returns null when both branches fail", async () => {
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).toBeNull();
  });

  it("fetches a specific file path", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(LONG + "changelog"));
    const result = await fetchGitHubContent("https://github.com/org/repo", "CHANGELOG.md");
    expect(result).not.toBeNull();
    const [url] = mockFetch.mock.calls[0]!;
    expect(url.toString()).toContain("CHANGELOG.md");
  });

  it("serves memory cache on second call", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(LONG + "cached"));
    const r1 = await fetchGitHubContent("https://github.com/org/cached-repo");
    const r2 = await fetchGitHubContent("https://github.com/org/cached-repo");
    expect(r1!.content).toBe(r2!.content);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when content is too short (<=100 chars)", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("short content"));
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).toBeNull();
  });
});

// ── fetchGitHubReleases ─────────────────────────────────────────────────────

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
    const cachedReleases = "## Recent Releases\n\n### v3.0.0\nCached from disk.\n";
    await disk.set("gh-releases:org/disk-releases-repo", cachedReleases);
    const result = await fetchGitHubReleases("https://github.com/org/disk-releases-repo");
    expect(result).toBe(cachedReleases);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── fetchGitHubExamples ─────────────────────────────────────────────────────

describe("fetchGitHubExamples", () => {
  it("returns null for non-GitHub URLs", async () => {
    const result = await fetchGitHubExamples("https://example.com/repo");
    expect(result).toBeNull();
  });

  it("returns first matching path content with prefix header", async () => {
    const changelogContent = "x".repeat(400);
    mockFetch.mockResolvedValueOnce(makeRes(changelogContent));
    const result = await fetchGitHubExamples("https://github.com/org/examples-repo");
    expect(result).not.toBeNull();
    expect(result).toContain("GitHub");
    expect(result).toContain(changelogContent.slice(0, 4000));
  });

  it("returns null when no path has content > 300 chars", async () => {
    mockFetch.mockResolvedValue(makeRes("short", 200));
    const result = await fetchGitHubExamples("https://github.com/org/empty-repo");
    expect(result).toBeNull();
  });

  it("returns null when all fetches fail (404)", async () => {
    mockFetch.mockResolvedValue(makeRes("", 404));
    const result = await fetchGitHubExamples("https://github.com/org/no-docs");
    expect(result).toBeNull();
  });

  it("serves memory cache on repeated calls", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("x".repeat(500)));
    const r1 = await fetchGitHubExamples("https://github.com/org/examples-cached");
    const r2 = await fetchGitHubExamples("https://github.com/org/examples-cached");
    expect(r1).toBe(r2);
    // Batched in groups of 6 — first successful batch returns early; second call hits cache
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it("serves disk cache hit: warms memory cache and returns without fetching", async () => {
    const { diskDocCache } = await import("./cache.js");
    const disk = diskDocCache as { get: (k: string) => Promise<string | undefined>; set: (k: string, v: string) => Promise<void>; clear: () => void };
    const cachedExamples = "GitHub examples content from disk cache.\n".repeat(10);
    await disk.set("gh-examples:org/disk-examples-repo", cachedExamples);
    const result = await fetchGitHubExamples("https://github.com/org/disk-examples-repo");
    expect(result).toBe(cachedExamples);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── fetchNpmPackage ─────────────────────────────────────────────────────────

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

describe("rankIndexLinks", () => {
  it("ranks links by topic relevance", () => {
    const content = "- [Authentication Guide](https://example.com/auth)\n- [Routing](https://example.com/routing)\n- [Caching](https://example.com/cache)";
    const result = rankIndexLinks(content, "authentication");
    expect(result[0]).toBe("https://example.com/auth");
  });

  it("returns top 5 links when no topic matches", () => {
    const content = "- [A](https://a.com)\n- [B](https://b.com)\n- [C](https://c.com)\n- [D](https://d.com)\n- [E](https://e.com)\n- [F](https://f.com)";
    const result = rankIndexLinks(content, "");
    expect(result).toHaveLength(5);
  });

  it("returns empty array for content with no links", () => {
    expect(rankIndexLinks("no links here", "auth")).toEqual([]);
  });
});

// ── fetchDevDocs ─────────────────────────────────────────────────────────────

describe("fetchDevDocs", () => {
  it("fetches docs via Jina for a known slug", async () => {
    mockFetch.mockResolvedValueOnce(makeRes(JINA_LONG, 200));
    const result = await fetchDevDocs("python", "async");
    expect(result).not.toBeNull();
  });

  it("returns null when Jina returns short content", async () => {
    mockFetch.mockResolvedValueOnce(makeRes("short", 200));
    const result = await fetchDevDocs("python");
    expect(result).toBeNull();
  });
});

// ── fetchDocs contentHash — additional paths ─────────────────────────────────

describe("fetchDocs contentHash — additional paths", () => {
  it("memory cache path: includes contentHash and fetchedAt", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("docs:https://example.com/mem-hash", LONG);
    const result = await fetchDocs("https://example.com/mem-hash");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(() => new Date(result.fetchedAt!)).not.toThrow();
  });

  it("Jina fallback path: includes contentHash and fetchedAt", async () => {
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes(JINA_LONG + "jinahash"));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/jina-hash-path");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(result.sourceType).toBe("jina");
  });

  it("direct fetch path: includes contentHash and fetchedAt", async () => {
    const directContent = LONG + "directhash";
    mockFetch.mockImplementation((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("r.jina.ai")) return Promise.resolve(makeRes("short", 200));
      if (u === "https://example.com/direct-hash-path") return Promise.resolve(makeRes(directContent));
      return Promise.resolve(makeRes("", 404));
    });
    const result = await fetchDocs("https://example.com/direct-hash-path");
    expect(result.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.fetchedAt).toBeDefined();
    expect(result.sourceType).toBe("direct");
  });
});
