import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-sitemap-swr-"));
});

import { fetchSitemapUrls } from "./sitemap.js";
import { docCache, diskDocCache } from "./cache.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const sitemap = (...paths: string[]) =>
  `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>https://swr.example.com${p}</loc></url>`).join("")}</urlset>`;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  docCache.clear();
  clearNegativeCache();
  resetAllCircuits();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(process.env.GT_CACHE_DIR ?? "", { recursive: true, force: true });
});

describe("sitemap cache (NET-05)", () => {
  it("promotes a disk hit with its remaining TTL, not a fresh one", async () => {
    await diskDocCache.set("sitemap:https://ttl.example.com:", JSON.stringify(["https://ttl.example.com/docs/a"]), 60_000);
    expect(await fetchSitemapUrls("https://ttl.example.com")).toEqual(["https://ttl.example.com/docs/a"]);
    let expiresAt = Infinity;
    docCache.get("sitemap:https://ttl.example.com:", { maxStaleMs: 0, onHit: (e) => { expiresAt = e; } });
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("serves a day-old URL list at once and refreshes it once in the background", async () => {
    await diskDocCache.set("sitemap:https://swr.example.com:", JSON.stringify(["https://swr.example.com/docs/old"]), -24 * 3_600_000);
    mockFetch.mockImplementation(async () => new Response(sitemap("/docs/new")));
    expect(await fetchSitemapUrls("https://swr.example.com")).toEqual(["https://swr.example.com/docs/old"]);
    await vi.waitFor(async () => expect(await fetchSitemapUrls("https://swr.example.com")).toEqual(["https://swr.example.com/docs/new"]));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
