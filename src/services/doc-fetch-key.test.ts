import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-doc-fetch-key-"));
});

import { fetchDocs } from "./doc-fetch.js";
import { docCache, diskDocCache, llmsProbeCache } from "./cache.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const prose = (title: string) => `# ${title}\n\n` + `${title} documentation prose about load functions and routing. `.repeat(12);
const LLMS = "https://cdn.kit.example.com/kit-llms.txt";

function route(table: Record<string, string>): void {
  mockFetch.mockImplementation(async (input) => {
    const body = table[String(input)];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  docCache.clear();
  llmsProbeCache.clear();
  clearNegativeCache();
  resetAllCircuits();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(process.env.GT_CACHE_DIR ?? "", { recursive: true, force: true });
});

describe("fetchDocs cache key covers the llms files", () => {
  it("does not answer from an entry cached for a different llms.txt", async () => {
    // What an older registry entry (llmsTxtUrl: the site-wide index) left on disk.
    await diskDocCache.set("docs:https://kit.example.com/docs", prose("Svelte"), -3 * 3_600_000);
    await diskDocCache.set("docs:https://kit.example.com/docs:sourceType", "llms-txt", -3 * 3_600_000);
    route({ [LLMS]: prose("SvelteKit") });
    const result = await fetchDocs("https://kit.example.com/docs", LLMS, undefined, "load function");
    expect(result.content).toContain("# SvelteKit");
    expect(result.url).toBe(LLMS);
  });

  it("keeps a caller without llms files apart from one with them", async () => {
    route({ "https://kit2.example.com/docs": prose("Page"), [LLMS]: prose("SvelteKit") });
    expect((await fetchDocs("https://kit2.example.com/docs")).content).toContain("# Page");
    expect((await fetchDocs("https://kit2.example.com/docs", LLMS)).content).toContain("# SvelteKit");
  });
});
