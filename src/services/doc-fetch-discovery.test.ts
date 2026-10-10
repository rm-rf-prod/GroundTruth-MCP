import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));

vi.mock("./cache.js", () => {
  const mem = new Map<string, string>();
  const disk = new Map<string, string>();
  return {
    docCache: {
      get: (k: string) => mem.get(k),
      set: (k: string, v: string) => { mem.set(k, v); },
      clear: () => { mem.clear(); },
    },
    diskDocCache: {
      get: async (k: string) => disk.get(k),
      set: async (k: string, v: string) => { disk.set(k, v); },
      clear: () => { disk.clear(); },
    },
    llmsProbeCache: { get: () => undefined, set: () => {} },
  };
});

import { fetchDocs } from "./doc-fetch.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";
import { docCache, diskDocCache } from "./cache.js";

const mockFetch = vi.fn<typeof fetch>();
const res = (body: string, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;
const README = "# jose\n\nJWT, JWS, JWE for JavaScript. " + "Usage: jwtVerify(token, key). ".repeat(20);
const requested = (): string[] => mockFetch.mock.calls.map(([u]) => u.toString());

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(res("", 404));
  (docCache as unknown as { clear: () => void }).clear();
  (diskDocCache as unknown as { clear: () => void }).clear();
  clearNegativeCache();
  resetAllCircuits();
});

describe("fetchDocs on github.com-hosted libraries (TOK-2)", () => {
  it("reads the raw README and never probes github.com/llms.txt", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://raw.githubusercontent.com/panva/jose/HEAD/README.md" ? res(README) : res("", 404));
    const result = await fetchDocs("https://github.com/panva/jose/tree/main#documentation");
    expect(result.content).toBe(README);
    expect(result.sourceType).toBe("github-readme");
    const urls = requested();
    expect(urls.some((u) => u.startsWith("https://github.com/llms") || u.startsWith("https://github.com/docs/llms"))).toBe(false);
    expect(urls.some((u) => u.startsWith("https://r.jina.ai/"))).toBe(false);
  });

  it("reads the /blob/ file a deep docsUrl points at", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://raw.githubusercontent.com/websockets/ws/HEAD/doc/ws.md" ? res(README) : res("", 404));
    const result = await fetchDocs("https://github.com/websockets/ws/blob/master/doc/ws.md");
    expect(result.content).toBe(README);
  });

  it("strips #readme from the repo path", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://raw.githubusercontent.com/dip/cmdk/HEAD/README.md" ? res(README) : res("", 404));
    const result = await fetchDocs("https://github.com/dip/cmdk#readme");
    expect(result.content).toBe(README);
  });

  it("serves github-readme as the source type on a cache hit", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString().startsWith("https://raw.githubusercontent.com/") ? res(README) : res("", 404));
    await fetchDocs("https://github.com/panva/jose");
    const hit = await fetchDocs("https://github.com/panva/jose");
    expect(hit.sourceType).toBe("github-readme");
  });
});

describe("fetchDocs cache hits report the fetched URL (ACC-10)", () => {
  it("returns the nested llms.txt URL on a warm call, same as the cold one", async () => {
    const index = "- [Guide](https://example.com/docs/guide)\n".repeat(30);
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://example.com/docs/llms.txt" ? res(index) : res("", 404));
    const cold = await fetchDocs("https://example.com/docs", "https://example.com/docs/llms.txt");
    const warm = await fetchDocs("https://example.com/docs", "https://example.com/docs/llms.txt");
    expect(cold.url).toBe("https://example.com/docs/llms.txt");
    expect(warm.url).toBe(cold.url);
  });
});

describe("fetchDocs Jina fallback (ACC-02)", () => {
  it("does not render a docs URL with Jina after it answered 404", async () => {
    await expect(fetchDocs("https://dead.example.com/docs/x")).rejects.toThrow();
    expect(requested().some((u) => u.startsWith("https://r.jina.ai/"))).toBe(false);
  });

  it("still falls back to Jina when direct extraction fails on a live page", async () => {
    const rendered = "# Rendered docs\n\n" + "Real content rendered by the reader service. ".repeat(10);
    mockFetch.mockImplementation(async (u) => {
      const s = u.toString();
      if (s === "https://spa.example.com/docs") return res("<html><body><div id=root></div></body></html>");
      if (s.startsWith("https://r.jina.ai/")) return res(rendered);
      return res("", 404);
    });
    const result = await fetchDocs("https://spa.example.com/docs");
    expect(result.sourceType).toBe("jina");
  });
});

describe("fetchDocs nested llms.txt choice follows the docs path (ACC-05)", () => {
  it("picks docs/kit/llms.txt for a /docs/kit docsUrl, not the first listed index", async () => {
    const root = [
      "# Svelte",
      "- [Svelte documentation](https://svelte.dev/docs/svelte/llms.txt)",
      "- [SvelteKit documentation](https://svelte.dev/docs/kit/llms.txt)",
      "- [CLI documentation](https://svelte.dev/docs/cli/llms.txt)",
    ].join("\n");
    const kit = "- [Loading data](https://svelte.dev/docs/kit/load)\n".repeat(20);
    const svelte = "- [$state](https://svelte.dev/docs/svelte/$state)\n".repeat(20);
    mockFetch.mockImplementation(async (u) => {
      const s = u.toString();
      if (s === "https://svelte.dev/llms.txt") return res(root);
      if (s === "https://svelte.dev/docs/kit/llms.txt") return res(kit);
      if (s === "https://svelte.dev/docs/svelte/llms.txt") return res(svelte);
      return res("", 404);
    });
    const result = await fetchDocs("https://svelte.dev/docs/kit", "https://svelte.dev/llms.txt");
    expect(result.url).toBe("https://svelte.dev/docs/kit/llms.txt");
  });
});

describe("fetchDocs GitHub route never lends the operator token to a caller URL", () => {
  const authed = (): boolean => mockFetch.mock.calls.some(([, init]) => new Headers(init?.headers).has("authorization"));
  afterEach(() => { delete process.env.GT_GITHUB_TOKEN; });

  it.each([
    "https://github.com/o/r/blob/main/../../../../user",
    "https://github.com/o/r/blob/main/%2e%2e/%2e%2e/%2e%2e/%2e%2e/user",
    "https://github.com/o/r/blob/main/a%2F..%2F..%2F..%2F..%2F..%2Fuser",
  ])("does not climb out of the repo for %s", async (url) => {
    process.env.GT_GITHUB_TOKEN = "ghp_test";
    await fetchDocs(url).catch(() => {});
    expect(requested().map((u) => new URL(u).href)).not.toContain("https://api.github.com/user");
    expect(authed()).toBe(false);
  });

  it("reads a /blob/ file anonymously even with GT_GITHUB_TOKEN set", async () => {
    process.env.GT_GITHUB_TOKEN = "ghp_test";
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://raw.githubusercontent.com/websockets/ws/HEAD/doc/ws.md" ? res(README) : res("", 404));
    expect((await fetchDocs("https://github.com/websockets/ws/blob/master/doc/ws.md")).content).toBe(README);
    expect(authed()).toBe(false);
  });

  it("leaves non-repo GitHub pages (issues, pulls) to the page fetch", async () => {
    await fetchDocs("https://github.com/o/r/issues/1").catch(() => {});
    expect(requested().some((u) => u.includes("raw.githubusercontent.com") || u.includes("api.github.com"))).toBe(false);
  });
});
