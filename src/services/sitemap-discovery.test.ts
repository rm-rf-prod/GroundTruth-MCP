import { describe, it, expect, beforeEach, vi } from "vitest";

const { mem, disk } = vi.hoisted(() => ({ mem: new Map<string, string>(), disk: new Map<string, string>() }));

vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));
vi.mock("./cache.js", () => ({
  docCache: { get: (k: string) => mem.get(k), set: (k: string, v: string) => { mem.set(k, v); } },
  diskDocCache: {
    get: async (k: string) => disk.get(k),
    set: async (k: string, v: string) => { disk.set(k, v); },
  },
}));

import { fetchSitemapUrls } from "./sitemap.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const res = (body: string, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;
const sitemap = (paths: string[]): string =>
  `<urlset>${paths.map((p) => `<url><loc>https://tanstack.com${p}</loc></url>`).join("")}</urlset>`;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(res("", 404));
  mem.clear();
  disk.clear();
  clearNegativeCache();
  resetAllCircuits();
});

describe("fetchSitemapUrls discovery scope (ACC-03)", () => {
  const routerPages = Array.from({ length: 600 }, (_, i) => `/router/latest/docs/guide/page-${i}`);
  const queryPage = "/query/latest/docs/framework/react/guides/invalidations-from-mutations";

  it("keeps pages past the first 500 and scopes them to the library's docs path", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://tanstack.com/sitemap.xml" ? res(sitemap([...routerPages, queryPage])) : res("", 404));
    const urls = await fetchSitemapUrls("https://tanstack.com/query/latest/docs");
    expect(urls).toEqual([`https://tanstack.com${queryPage}`]);
  });

  it("falls back to the unscoped list when nothing sits under the docs path", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://tanstack.com/sitemap.xml" ? res(sitemap(routerPages.slice(0, 3))) : res("", 404));
    const urls = await fetchSitemapUrls("https://tanstack.com/query/latest/docs");
    expect(urls).toHaveLength(3);
  });

  it("never reads github.com sitemaps for a repo docsUrl", async () => {
    expect(await fetchSitemapUrls("https://github.com/panva/jose")).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("fetchSitemapUrls caching (NET-09)", () => {
  it("serves a disk hit without refetching (new process, empty memory)", async () => {
    disk.set("sitemap:https://nextjs.org:docs", JSON.stringify(["https://nextjs.org/docs/app"]));
    expect(await fetchSitemapUrls("https://nextjs.org/docs")).toEqual(["https://nextjs.org/docs/app"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caches an empty result so the next call does not re-download", async () => {
    // 200 with no <loc> entries (an error page served as the sitemap): the 404 negative cache does not cover it.
    mockFetch.mockResolvedValue(res("<html><body>Page not found on this documentation site.</body></html>"));
    await fetchSitemapUrls("https://empty.example.com/docs");
    const calls = mockFetch.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    mem.clear();
    await fetchSitemapUrls("https://empty.example.com/docs");
    expect(mockFetch.mock.calls.length).toBe(calls);
  });

  it("shares one download between concurrent callers", async () => {
    mockFetch.mockImplementation(async (u) =>
      u.toString() === "https://tanstack.com/sitemap.xml" ? res(sitemap(["/query/latest/docs/overview"])) : res("", 404));
    await Promise.all([fetchSitemapUrls("https://tanstack.com/query/latest"), fetchSitemapUrls("https://tanstack.com/query/latest")]);
    const sitemapCalls = mockFetch.mock.calls.filter(([u]) => u.toString() === "https://tanstack.com/sitemap.xml");
    expect(sitemapCalls).toHaveLength(1);
  });
});
