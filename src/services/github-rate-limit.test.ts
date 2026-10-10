import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-github-limit-"));
});

import { fetchGitHubContent, fetchGitHubReleases } from "./github.js";
import { docCache } from "./cache.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const apiCalls = () => mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("https://api.github.com/"));
const RELEASES = JSON.stringify([{ tag_name: "v1.0.0", body: "Initial release" }]);

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  docCache.clear();
  clearNegativeCache();
  resetAllCircuits();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(process.env.GT_CACHE_DIR ?? "", { recursive: true, force: true });
});

describe("api.github.com rate limit", () => {
  it("keeps calling after a 403 that is not a rate limit", async () => {
    mockFetch.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    expect(await fetchGitHubReleases("https://github.com/o/forbidden")).toBeNull();
    mockFetch.mockResolvedValueOnce(new Response(RELEASES));
    expect(await fetchGitHubReleases("https://github.com/o/open")).toContain("v1.0.0");
    expect(apiCalls()).toHaveLength(2);
  });

  it("stops calling for 60 s after a rate-limit answer, then resumes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mockFetch.mockResolvedValueOnce(new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    expect(await fetchGitHubReleases("https://github.com/o/a")).toBeNull();
    expect(await fetchGitHubReleases("https://github.com/o/b")).toBeNull();
    expect(apiCalls()).toHaveLength(1);

    vi.setSystemTime(Date.now() + 61_000);
    mockFetch.mockResolvedValueOnce(new Response(RELEASES));
    expect(await fetchGitHubReleases("https://github.com/o/b")).toContain("v1.0.0");
    expect(apiCalls()).toHaveLength(2);
  });

  it("skips the README API fallback while paused", async () => {
    // Past the pause the previous test left behind.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 120_000);
    mockFetch.mockImplementation(async (input) =>
      String(input).includes("/releases")
        ? new Response("slow down", { status: 429, headers: { "retry-after": "30" } })
        : new Response("missing", { status: 404 }),
    );
    await fetchGitHubReleases("https://github.com/o/c");
    expect(await fetchGitHubContent("https://github.com/o/c")).toBeNull();
    expect(apiCalls()).toEqual(["https://api.github.com/repos/o/c/releases?per_page=30"]);
  });
});
