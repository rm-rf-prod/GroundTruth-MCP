import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompatTool } from "./compat.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../services/fetcher.js", () => ({
  fetchAsMarkdownRace: vi.fn(),
}));

vi.mock("../utils/extract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/extract.js")>()),
  extractRelevantContent: vi.fn((content: string, _topic: string, _tokens: number) => ({
    text: content,
    truncated: false,
  })),
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

vi.mock("../utils/guard.js", () => ({
  withToolTimeout: async <T,>(fn: () => Promise<T>) => fn(),
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

vi.mock("../services/cache.js", () => ({
  docCache: { get: vi.fn(() => undefined), set: vi.fn() },
}));

vi.mock("../services/search/topic-match.js", () => ({
  findTopicUrls: vi.fn(() => []),
}));

vi.mock("../services/search/engines.js", () => ({
  searchMDN: vi.fn(async () => []),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { fetchAsMarkdownRace } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { findTopicUrls } from "../services/search/topic-match.js";
import { extractRelevantContent } from "../utils/extract.js";

// ── Handler capture ──────────────────────────────────────────────────────────

type HandlerInput = { feature: string; environments?: string[]; tokens?: number };
type HandlerResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
};
type Handler = (input: HandlerInput) => Promise<HandlerResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

registerCompatTool(mockServer);

// ── Helpers ──────────────────────────────────────────────────────────────────

const MDN_CONTENT = "# CSS Container Queries\n\nBrowser compatibility table: Chrome 105+, Firefox 110+, Safari 16+.".repeat(5);

beforeEach(() => {
  vi.mocked(fetchAsMarkdownRace).mockReset();
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(docCache.get).mockReset().mockReturnValue(undefined);
  vi.mocked(docCache.set).mockReset();
  vi.mocked(findTopicUrls).mockReset().mockReturnValue([]);
  vi.mocked(extractRelevantContent).mockImplementation((content, _topic, _tokens) => ({
    text: content,
    truncated: false,
  }));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("gt_compat handler", () => {
  describe("caches result", () => {
    it("sets cache after successful fetch", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(MDN_CONTENT);
      await handler({ feature: "container queries" });
      expect(docCache.set).toHaveBeenCalled();
    });
  });

  describe("parameterized: various feature types", () => {
    it.each([
      ["CSS container queries"],
      ["Array.at()"],
      ["Web Bluetooth API"],
      ["AbortController"],
      ["ResizeObserver"],
    ])("handles feature: %s", async (feature) => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(MDN_CONTENT);
      const result = await handler({ feature });
      expect(result.content[0]!.text).toBeDefined();
      expect(result.content[0]!.text.length).toBeGreaterThan(0);
    });
  });
});
