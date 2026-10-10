import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-github-swr-"));
});

import { fetchGitHubContent, fetchGitHubReleases } from "./github.js";
import { docCache, diskDocCache } from "./cache.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const readme = (day: string) => `# ${day}\n\n` + "README text. ".repeat(20);

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

describe("GitHub content cache (NET-05)", () => {
  it("serves a day-old README at once and refreshes it once in the background", async () => {
    await diskDocCache.set("gh:o/r:README.md", readme("Yesterday"), -24 * 3_600_000);
    mockFetch.mockImplementation(async () => new Response(readme("Today")));
    expect((await fetchGitHubContent("https://github.com/o/r"))?.content).toContain("# Yesterday");
    await vi.waitFor(async () => expect((await fetchGitHubContent("https://github.com/o/r"))?.content).toContain("# Today"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("promotes a disk hit with its remaining TTL", async () => {
    await diskDocCache.set("gh-releases:o/r", "## Recent Releases\n", 60_000);
    expect(await fetchGitHubReleases("https://github.com/o/r")).toContain("Recent Releases");
    let expiresAt = 0;
    docCache.get("gh-releases:o/r", { maxStaleMs: 0, onHit: (e) => { expiresAt = e; } });
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cancels the body of a rate-limited releases answer", async () => {
    const cancel = vi.fn(async () => {});
    mockFetch.mockResolvedValue({ ok: false, status: 403, headers: new Headers(), body: { cancel } } as unknown as Response);
    expect(await fetchGitHubReleases("https://github.com/o/limited")).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
});
