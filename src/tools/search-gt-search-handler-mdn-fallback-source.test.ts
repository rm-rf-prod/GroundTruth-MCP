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
  describe("MDN fallback source", () => {
    it("tries MDN search as last resort when nothing else works", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("search failed"));
      // Return null for everything EXCEPT MDN search URL
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
        if (url.includes("developer.mozilla.org/en-US/search")) return LONG_CONTENT;
        return null;
      });
      const result = await handler({ query: "completely unknown xyz topic 99999" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(
        expect.stringContaining("developer.mozilla.org"),
      );
      expect(result.content[0]!.text).toBeDefined();
    });

    it("returns MDN result in sources", async () => {
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

    it("does not reach MDN fallback when topic map has results", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      await handler({ query: "OWASP injection vulnerabilities" });
      const mdnSearchCalls = vi.mocked(fetchViaJina).mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("search?q="),
      );
      expect(mdnSearchCalls).toHaveLength(0);
    });
  });

  describe("caching behavior", () => {
    it("returns cached content without calling fetchViaJina", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(fetchViaJina).not.toHaveBeenCalled();
    });

    it("stores fetched content in cache", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(docCache.set).toHaveBeenCalled();
    });
  });
});
