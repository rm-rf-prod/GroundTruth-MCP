import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));

vi.mock("./cache.js", () => {
  const mem = new Map<string, string>();
  return {
    docCache: {
      get: (k: string) => mem.get(k),
      set: (k: string, v: string) => { mem.set(k, v); },
      clear: () => { mem.clear(); },
    },
    diskDocCache: { get: async () => undefined, set: async () => {} },
  };
});

import { fetchGitHubContent, fetchGitHubExamples, isGitHubHost } from "./github.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";
import { docCache } from "./cache.js";

const mockFetch = vi.fn<typeof fetch>();
const res = (body: string, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;
const BODY = "# Project\n\n" + "Usage notes and examples for the project. ".repeat(10);
const requested = (): string[] => mockFetch.mock.calls.map(([u]) => u.toString());

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(res("", 404));
  (docCache as unknown as { clear: () => void }).clear();
  clearNegativeCache();
  resetAllCircuits();
  delete process.env.GT_GITHUB_TOKEN;
});

describe("fetchGitHubContent default-branch lookup (NET-10)", () => {
  it("resolves any default branch with one raw HEAD request", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://raw.githubusercontent.com/vercel/next.js/HEAD/CHANGELOG.md" ? res(BODY) : res("", 404));
    const result = await fetchGitHubContent("https://github.com/vercel/next.js", "CHANGELOG.md");
    expect(result?.content).toBe(BODY);
    expect(requested()).toEqual(["https://raw.githubusercontent.com/vercel/next.js/HEAD/CHANGELOG.md"]);
  });

  it("makes one API call (no per-branch loop) when the raw file is missing", async () => {
    const result = await fetchGitHubContent("https://github.com/org/repo");
    expect(result).toBeNull();
    const api = requested().filter((u) => u.startsWith("https://api.github.com/"));
    expect(api).toEqual(["https://api.github.com/repos/org/repo/readme"]);
    expect(requested()).toHaveLength(2);
  });

  it("uses the contents API for a non-README path", async () => {
    await fetchGitHubContent("https://github.com/org/repo", "docs/api.md");
    expect(requested()).toContain("https://api.github.com/repos/org/repo/contents/docs/api.md");
  });

  it("drops #fragment, ?query and .git from the repo path", async () => {
    mockFetch.mockResolvedValue(res(BODY));
    await fetchGitHubContent("https://github.com/dip/cmdk#readme");
    await fetchGitHubContent("https://github.com/org/tool.git");
    expect(requested()).toEqual([
      "https://raw.githubusercontent.com/dip/cmdk/HEAD/README.md",
      "https://raw.githubusercontent.com/org/tool/HEAD/README.md",
    ]);
  });
});

describe("fetchGitHubExamples default-branch lookup (NET-10)", () => {
  it("probes each path once on HEAD instead of main and master", async () => {
    await fetchGitHubExamples("https://github.com/org/no-docs");
    const urls = requested();
    expect(urls.every((u) => u.includes("/HEAD/"))).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("isGitHubHost", () => {
  it("matches github.com only", () => {
    expect(isGitHubHost("https://github.com/panva/jose")).toBe(true);
    expect(isGitHubHost("https://docs.github.com/en")).toBe(false);
    expect(isGitHubHost("https://raw.githubusercontent.com/a/b/HEAD/README.md")).toBe(false);
    expect(isGitHubHost("not a url")).toBe(false);
  });
});

describe("fetchGitHubContent path guard (caller-supplied paths)", () => {
  it.each(["../../../../user", "docs/%2e%2e/%2E%2E/x", "a%2F..%2F..%2Fuser", "..\\..\\user", "docs/%252e%252e/x"])(
    "returns null without a request for the dot-segment path %s",
    async (path) => {
      expect(await fetchGitHubContent("https://github.com/o/r", path)).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("rejects a dot-segment repo path", async () => {
    expect(await fetchGitHubContent("https://github.com/o/%2e%2e")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps legitimate dotted names and encoded spaces", async () => {
    mockFetch.mockResolvedValue(res(BODY));
    await fetchGitHubContent("https://github.com/socketio/socket.io", "docs/Getting%20Started.md");
    expect(requested()).toEqual(["https://raw.githubusercontent.com/socketio/socket.io/HEAD/docs/Getting%20Started.md"]);
  });

  it("sends no Authorization in anonymous mode, raw or API", async () => {
    process.env.GT_GITHUB_TOKEN = "ghp_test";
    await fetchGitHubContent("https://github.com/o/r", "docs/api.md", false);
    expect(requested()).toHaveLength(2);
    expect(mockFetch.mock.calls.some(([, init]) => new Headers(init?.headers).has("authorization"))).toBe(false);
  });
});
