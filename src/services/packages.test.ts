import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-packages-swr-"));
});

import { fetchNpmPackage } from "./packages.js";
import { docCache, diskDocCache } from "./cache.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
// Over tryFetch's 50-char floor for an empty body.
const meta = (version: string) => ({ version, description: "A package with a description long enough to count." });

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

describe("package metadata cache (NET-05)", () => {
  it("serves day-old npm metadata at once and refreshes it once in the background", async () => {
    await diskDocCache.set("npm:pkg", JSON.stringify(meta("1.0.0")), -24 * 3_600_000);
    mockFetch.mockImplementation(async () => new Response(JSON.stringify(meta("2.0.0"))));
    expect(await fetchNpmPackage("pkg")).toEqual(meta("1.0.0"));
    await vi.waitFor(async () => expect(await fetchNpmPackage("pkg")).toEqual(meta("2.0.0")));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("promotes a disk hit with its remaining TTL, not a fresh one", async () => {
    await diskDocCache.set("npm:ttl", JSON.stringify(meta("1.0.0")), 60_000);
    await fetchNpmPackage("ttl");
    let expiresAt = 0;
    docCache.get("npm:ttl", { maxStaleMs: 0, onHit: (e) => { expiresAt = e; } });
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
