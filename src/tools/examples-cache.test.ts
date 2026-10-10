import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";
import type { McpServer } from "@modelcontextprotocol/server";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-examples-swr-"));
});

vi.mock("../services/fetcher.js", () => ({
  fetchWithTimeout: vi.fn(),
  githubAuthHeaders: vi.fn(() => ({})),
}));
vi.mock("../services/snippets/build-index.js", () => ({ buildIndex: vi.fn(async () => null) }));

import { registerExamplesTool } from "./examples.js";
import { fetchWithTimeout } from "../services/fetcher.js";
import { docCache, diskDocCache } from "../services/cache.js";

type Handler = (input: { library: string; maxResults: number }) => Promise<{ content: Array<{ text: string }> }>;
let handler!: Handler;
registerExamplesTool({ registerTool: (_n: string, _c: unknown, h: Handler) => { handler = h; } } as unknown as McpServer);

const KEY = "gh-code-examples:import zod -path:test -path:__test__ -path:spec -path:node_modules -path:.next " +
  "-extension:md -extension:mdx -extension:markdown -extension:rst -extension:txt:5";
const SEARCH = {
  total_count: 1,
  items: [{ name: "a.ts", path: "src/a.ts", html_url: "https://github.com/o/r/blob/main/src/a.ts",
    repository: { full_name: "o/fresh", html_url: "https://github.com/o/fresh" } }],
};
const call = async (library = "zod"): Promise<string> => (await handler({ library, maxResults: 5 })).content[0]?.text ?? "";

beforeEach(() => {
  docCache.clear();
  vi.mocked(fetchWithTimeout).mockReset();
  process.env.GT_GITHUB_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.GT_GITHUB_TOKEN;
});

afterAll(() => {
  rmSync(process.env.GT_CACHE_DIR ?? "", { recursive: true, force: true });
});

describe("gt_examples cache (NET-05)", () => {
  it("promotes a disk hit with its remaining TTL, not a fresh one", async () => {
    await diskDocCache.set(KEY, "DISK RESULT", 60_000);
    expect(await call()).toBe("DISK RESULT");
    let expiresAt = Infinity;
    docCache.get(KEY, { maxStaleMs: 0, onHit: (e) => { expiresAt = e; } });
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("serves a day-old result at once and refreshes it once in the background", async () => {
    await diskDocCache.set(KEY, "YESTERDAY", -24 * 3_600_000);
    vi.mocked(fetchWithTimeout).mockImplementation(async () => new Response(JSON.stringify(SEARCH)));
    expect(await call()).toBe("YESTERDAY");
    await vi.waitFor(async () => expect(await call()).toContain("o/fresh"));
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it("discards the body of a failed code search", async () => {
    const cancel = vi.fn(async () => {});
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 500, headers: new Headers(), body: { cancel } } as unknown as Response);
    expect(await call("valibot")).toContain("HTTP 500");
    expect(cancel).toHaveBeenCalled();
  });
});
