import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompatTool } from "./compat.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../services/fetcher.js", () => ({
  fetchViaJina: vi.fn(),
}));

vi.mock("../utils/extract.js", () => ({
  extractRelevantContent: vi.fn((content: string, _topic: string, _tokens: number) => ({
    text: content,
    truncated: false,
  })),
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

vi.mock("../services/cache.js", () => ({
  docCache: { get: vi.fn(() => undefined), set: vi.fn() },
}));

vi.mock("./search.js", () => ({
  findTopicUrls: vi.fn(() => []),
  registerSearchTool: vi.fn(),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { fetchViaJina } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { findTopicUrls } from "./search.js";
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
  vi.mocked(fetchViaJina).mockReset();
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

describe("registerCompatTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_compat",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_compat handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when feature is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ feature: "dump all data" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
      expect(fetchViaJina).not.toHaveBeenCalled();
    });
  });

  describe("cache hit", () => {
    it("returns cached result without fetching", async () => {
      vi.mocked(docCache.get).mockReturnValue("CACHED_COMPAT");
      const result = await handler({ feature: "CSS container queries" });
      expect(result.content[0]!.text).toBe("CACHED_COMPAT");
      expect(fetchViaJina).not.toHaveBeenCalled();
    });
  });

  describe("topic map hit", () => {
    it("uses MDN URL from topic map when available", async () => {
      vi.mocked(findTopicUrls).mockReturnValue([
        { name: "CSS Container Queries", urls: ["https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries"] },
      ]);
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      await handler({ feature: "CSS container queries" });
      expect(fetchViaJina).toHaveBeenCalledWith(
        "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries",
      );
    });
  });

  describe("MDN search fallback", () => {
    it("constructs MDN search URL when no topic map match", async () => {
      vi.mocked(findTopicUrls).mockReturnValue([]);
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      await handler({ feature: "Array.groupBy" });
      expect(fetchViaJina).toHaveBeenCalledWith(
        expect.stringContaining("developer.mozilla.org"),
      );
      expect(fetchViaJina).toHaveBeenCalledWith(
        expect.stringContaining("Array.groupBy"),
      );
    });
  });

  describe("response format", () => {
    it("includes feature name in response header", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      const result = await handler({ feature: "AbortController" });
      expect(result.content[0]!.text).toContain("AbortController");
    });

    it("wraps response in withNotice", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      const result = await handler({ feature: "AbortController" });
      expect(result.content[0]!.text).toMatch(/^NOTICE/);
    });

    it("includes environments in structuredContent", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      const result = await handler({
        feature: "fetch API",
        environments: ["chrome", "firefox"],
      });
      expect(result.structuredContent?.environments).toEqual(["chrome", "firefox"]);
    });

    it("returns empty environments array when not provided", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      const result = await handler({ feature: "fetch API" });
      expect(result.structuredContent?.environments).toEqual([]);
    });
  });

  describe("empty result", () => {
    it("returns no-data message when all fetches return empty", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      const result = await handler({ feature: "obscure-feature-xyz" });
      expect(result.content[0]!.text).toContain("No compatibility data found");
    });

    it("returns no-data message when fetched content is too short", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue("hi");
      const result = await handler({ feature: "obscure-feature-xyz" });
      expect(result.content[0]!.text).toContain("No compatibility data found");
    });
  });

  describe("caniuse fallback for CSS features", () => {
    it("also fetches caniuse for CSS features", async () => {
      vi.mocked(fetchViaJina)
        .mockResolvedValueOnce(MDN_CONTENT)
        .mockResolvedValueOnce("caniuse data content here for browsers");
      await handler({ feature: "CSS grid layout" });
      const calls = vi.mocked(fetchViaJina).mock.calls;
      expect(calls.some(([url]) => String(url).includes("caniuse.com"))).toBe(true);
    });
  });

  describe("caches result", () => {
    it("sets cache after successful fetch", async () => {
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      await handler({ feature: "AbortController" });
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
      vi.mocked(fetchViaJina).mockResolvedValue(MDN_CONTENT);
      const result = await handler({ feature });
      expect(result.content[0]!.text).toBeDefined();
      expect(result.content[0]!.text.length).toBeGreaterThan(0);
    });
  });
});
