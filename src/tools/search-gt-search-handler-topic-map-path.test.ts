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
  describe("topic map path", () => {
    it("uses topic map for OWASP query", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(fetchAsMarkdownRace).toHaveBeenCalled();
      expect(result.structuredContent?.sources.length).toBeGreaterThan(0);
      expect(result.structuredContent?.sources[0]!.name).toContain("OWASP");
    });

    it("uses topic map for WCAG accessibility query", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      const result = await handler({ query: "WCAG accessibility guidelines" });
      expect(result.structuredContent?.sources.length).toBeGreaterThan(0);
    });

    it("uses topic map for Core Web Vitals query", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      const result = await handler({ query: "Core Web Vitals optimization" });
      expect(result.structuredContent?.sources.length).toBeGreaterThan(0);
    });

    it("uses topic map for JWT query", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      const result = await handler({ query: "JWT security best practices" });
      expect(result.structuredContent?.sources.length).toBeGreaterThan(0);
    });

    it("caps topic sources at 3", async () => {
      // Many patterns could match "auth authentication password session"
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      const result = await handler({
        query: "auth authentication password session cors xss owasp performance core web vitals indexeddb",
      });
      expect(result.structuredContent?.sources.length).toBeLessThanOrEqual(3);
    });

    it("uses cached content when available", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(fetchViaJina).not.toHaveBeenCalled();
      expect(result.structuredContent?.sources.length).toBeGreaterThan(0);
    });

    it("caches fetched topic content", async () => {
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(LONG_CONTENT);
      await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(docCache.set).toHaveBeenCalled();
    });

    it("skips topic URL when content is <=200 chars", async () => {
      // First URL returns short content, second returns long content
      vi.mocked(fetchViaJina)
        .mockResolvedValueOnce("too short content") // first URL
        .mockResolvedValueOnce(LONG_CONTENT); // second URL
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(result.content[0]!.text).toBeDefined();
    });
  });

});
