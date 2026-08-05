import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool, findTopicUrls } from "./search.js";

// ── Dependency mocks ────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  fuzzySearch: vi.fn(() => []),
  lookupById: vi.fn(() => null),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchWithTimeout: vi.fn(),
  fetchViaJina: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  fetchDevDocs: vi.fn(),
  isIndexContent: vi.fn().mockReturnValue(false),
  rankIndexLinks: vi.fn().mockReturnValue([]),
  isErrorPage: vi.fn().mockReturnValue(false),
  hashContent: vi.fn((s: string) => `h:${s}`),
}));

vi.mock("../utils/extract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/extract.js")>()),
  extractRelevantContent: vi.fn((content: string, _topic: string, _tokens: number) => ({
    text: content,
    truncated: false,
  })),
  normalizeQueryYear: vi.fn((query: string) => {
    const currentYear = new Date().getFullYear();
    return query.replace(/(?<![./\w])(20[12][0-9])(?![./\w])/g, (match: string) => {
      const year = parseInt(match, 10);
      return year < currentYear ? String(currentYear) : match;
    });
  }),
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

vi.mock("../utils/quality.js", () => ({
  computeQualityScore: vi.fn(() => ({ score: 0.8, hints: [] })),
}));

vi.mock("../services/cache.js", () => ({
  docCache: {
    get: vi.fn(() => undefined),
    set: vi.fn(),
    has: vi.fn(() => false),
    clear: vi.fn(),
  },
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { fuzzySearch, lookupById } from "../sources/registry.js";
import { fetchDocs, fetchWithTimeout, fetchViaJina, fetchAsMarkdownRace, fetchDevDocs } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { docCache } from "../services/cache.js";

// ── Handler capture ─────────────────────────────────────────────────────────

type HandlerInput = { query: string; tokens?: number };
type HandlerResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: { query: string; sources: Array<{ name: string; url: string; content: string }> };
};
type Handler = (input: HandlerInput) => Promise<HandlerResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

registerSearchTool(mockServer);

// ── Helpers ─────────────────────────────────────────────────────────────────

const LONG_CONTENT = "OWASP vulnerabilities, WCAG accessibility guidelines, Core Web Vitals optimization, JWT security, authentication sessions. This is detailed web development content. ".repeat(10);

const makeFetchResult = (content = LONG_CONTENT) => ({
  content,
  url: "https://example.com/docs",
  sourceType: "llms-txt" as const,
});

beforeEach(() => {
  vi.mocked(fuzzySearch).mockReset().mockReturnValue([]);
  vi.mocked(lookupById).mockReset().mockReturnValue(null);
  vi.mocked(fetchDocs).mockReset();
  vi.mocked(fetchWithTimeout).mockReset();
  vi.mocked(fetchViaJina).mockReset().mockResolvedValue(null);
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(null);
  vi.mocked(fetchDevDocs).mockReset().mockResolvedValue(null);
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(docCache.get).mockReset().mockReturnValue(undefined);
  vi.mocked(docCache.set).mockReset();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("gt_search handler", () => {
  describe("web search fallback", () => {
    it("calls webSearch when no registry, topic, or direct docs matches", async () => {
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(
          `<a href="https://developer.mozilla.org/en-US/docs/Web/API/SomeAPI">MDN API</a>`,
        ),
        status: 200,
      } as unknown as Response;
      vi.mocked(fetchWithTimeout).mockResolvedValue(mockResponse);
      // Return null for direct docs URLs, LONG_CONTENT only for web search results
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
        if (url.includes("developer.mozilla.org/en-US/docs/Web/API/SomeAPI")) return LONG_CONTENT;
        return null;
      });
      await handler({ query: "some obscure undocumented topic xyz123" });
      expect(fetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining("duckduckgo.com"),
        expect.any(Number),
        expect.any(Object),
      );
    });

    it("falls back to DDG Lite when DDG HTML fails", async () => {
      vi.mocked(fetchWithTimeout)
        .mockRejectedValue(new Error("all fetch calls fail"));
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(null);
      await handler({ query: "some obscure undocumented topic xyz456" });
      // Verify DDG Lite was attempted after DDG HTML failed
      expect(fetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining("lite.duckduckgo.com"),
        expect.any(Number),
        expect.any(Object),
      );
    });

    it("skips web result when content is <=200 chars", async () => {
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(
          `<a href="https://developer.mozilla.org/en-US/docs/Something">MDN</a>`,
        ),
        status: 200,
      } as unknown as Response;
      vi.mocked(fetchWithTimeout).mockResolvedValue(mockResponse);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("too short"); // <200 chars
      await handler({ query: "some obscure topic zzzz9999" });
      // Falls through to MDN fallback
      expect(result => result).toBeDefined();
    });
  });

  describe("MDN fallback", () => {
    it("tries MDN search when no other results found", async () => {
      // No registry matches, no topic map matches, no web search results
      vi.mocked(fetchWithTimeout).mockResolvedValue({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue(""),
      } as unknown as Response);
      // Return null for everything EXCEPT MDN search URL
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
        if (url.includes("developer.mozilla.org/en-US/search")) return LONG_CONTENT;
        return null;
      });
      const result = await handler({ query: "completely unknown xyz9999 topic" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(
        expect.stringContaining("developer.mozilla.org"),
      );
      expect(result.content[0]!.text).toBeDefined();
    });

    it("uses MDN result content in sources", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("all search failed"));
      // Return null for everything EXCEPT MDN search URL
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
        if (url.includes("developer.mozilla.org/en-US/search")) return `Obscure xyz000 topic guide. ${LONG_CONTENT}`;
        return null;
      });
      const result = await handler({ query: "unknown obscure xyz000 topic" });
      const mdnSource = result.structuredContent?.sources.find((s: { name: string }) => s.name.includes("MDN search results"));
      expect(mdnSource).toBeDefined();
    });
  });

});
