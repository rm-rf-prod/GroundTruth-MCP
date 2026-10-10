import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";

vi.mock("fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("../services/fetcher.js", () => ({ fetchDocs: vi.fn() }));
vi.mock("../utils/lockfile.js", () => ({ detectAllVersions: vi.fn(async () => new Map<string, string>()) }));
vi.mock("../utils/guard.js", () => ({
  withNotice: (text: string) => text,
  withToolTimeout: async (fn: () => Promise<unknown>) => fn(),
  safeguardPath: (p: string) => p,
}));

import { readFile } from "fs/promises";
import { fetchDocs } from "../services/fetcher.js";
import { registerAutoScanTool } from "./auto-scan.js";
import { renderScanReport } from "./auto-scan-report.js";

type Result = { content: Array<{ text: string }>; structuredContent: { matched: string[] } };
let handler!: (input: { projectPath?: string; tokensPerLib?: number }) => Promise<Result>;
let schema!: z.ZodType;
registerAutoScanTool({
  registerTool: (_n: string, config: { inputSchema: z.ZodType }, h: typeof handler) => {
    schema = config.inputSchema;
    handler = h;
  },
} as unknown as McpServer);

// Twelve dependencies that all resolve to distinct registry entries.
const DEPS = ["react", "next", "vue", "svelte", "zod", "prisma", "express", "fastify", "tailwindcss", "axios", "hono", "astro"];

beforeEach(() => {
  vi.mocked(readFile).mockImplementation(async (file) => {
    if (String(file).endsWith("package.json")) {
      return JSON.stringify({ dependencies: Object.fromEntries(DEPS.map((d) => [d, "^1.0.0"])) });
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  vi.mocked(fetchDocs).mockReset().mockResolvedValue({
    content: "Best practices content. ".repeat(40),
    url: "https://example.com/llms.txt",
    sourceType: "llms-txt",
  });
});

describe("gt_auto_scan — survey-sized default", () => {
  it("defaults to 500 tokens per library", () => {
    expect(schema.parse({})).toMatchObject({ tokensPerLib: 500 });
  });

  it("fetches at most 10 libraries and names the rest for a deep-dive", async () => {
    const result = await handler({ projectPath: "/p", tokensPerLib: 500 });
    expect(vi.mocked(fetchDocs).mock.calls.length).toBe(10);
    expect(result.structuredContent.matched).toHaveLength(10);
    const text = result.content[0]!.text;
    expect(text).toMatch(/Not fetched: Hono, Astro/);
    expect(text).toContain("gt_best_practices");
    expect(text).not.toContain("capped at 20");
  });
});

describe("renderScanReport", () => {
  it("says nothing about a cap when every matched library was fetched", () => {
    const report = renderScanReport({
      projectPath: "/p",
      topic: "security",
      sources: [],
      totalDeps: 1,
      topMatched: [],
      notFetched: [],
      unmatched: [],
      versions: new Map(),
      results: [],
    });
    expect(report.text).not.toContain("Not fetched");
  });
});
