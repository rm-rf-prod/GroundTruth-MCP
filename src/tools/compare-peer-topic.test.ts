import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

const store = new Map<string, string>();
vi.mock("../services/cache.js", () => ({
  docCache: { get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v) },
}));
vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchAsMarkdownRace: vi.fn(async () => null),
  isIndexContent: () => false,
  rankIndexLinks: () => [],
  hashContent: (s: string) => `#${s}`,
}));
vi.mock("../utils/extract.js", () => ({
  extractRelevantContent: vi.fn((content: string) => ({ text: content, truncated: false })),
}));
vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: () => false,
  withNotice: (t: string) => t,
  withToolTimeout: async (fn: () => Promise<unknown>) => fn(),
}));

import { fetchDocs } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { registerCompareTool } from "./compare.js";

let handler!: (input: { libraries: string[]; criteria?: string; tokens?: number }) => Promise<unknown>;
registerCompareTool({
  registerTool: (_n: string, _c: unknown, h: typeof handler) => {
    handler = h;
  },
} as unknown as McpServer);

const topicFor = (docsUrl: string): string | undefined =>
  vi.mocked(fetchDocs).mock.calls.find((c) => c[0] === docsUrl)?.[3];

beforeEach(() => {
  store.clear();
  vi.mocked(fetchDocs).mockReset().mockImplementation(async (docsUrl: string) => ({
    content: `Docs from ${docsUrl}. `.repeat(30),
    url: docsUrl,
    sourceType: "llms-txt" as const,
  }));
  vi.mocked(extractRelevantContent).mockClear();
});

describe("gt_compare — per-library topic", () => {
  it("names the other compared libraries in each library's topic", async () => {
    await handler({ libraries: ["zustand", "jotai"], tokens: 2000 });
    const zustandDocs = vi.mocked(fetchDocs).mock.calls[0]![0];
    const jotaiDocs = vi.mocked(fetchDocs).mock.calls[1]![0];
    expect(topicFor(zustandDocs)).toMatch(/^jotai .*comparison/);
    expect(topicFor(jotaiDocs)).toMatch(/^zustand .*comparison/);
    expect(vi.mocked(extractRelevantContent).mock.calls.map((c) => c[1])).toEqual([topicFor(zustandDocs), topicFor(jotaiDocs)]);
  });

  it("keeps the full criteria in the cache key, so different criteria never share a cached extract", async () => {
    const libraries = ["@tanstack/react-query", "swr"];
    await handler({ libraries, criteria: "bundle size and tree shaking" });
    await handler({ libraries, criteria: "bundle size and tree shaking in SSR" });
    expect(vi.mocked(fetchDocs)).toHaveBeenCalledTimes(4);
    expect(store.size).toBe(4);
  });
});
