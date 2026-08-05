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
  describe("registry path", () => {
    it("calls fuzzySearch with the query and limit 3", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const reactEntry = {
        id: "facebook/react",
        name: "React",
        docsUrl: "https://react.dev",
        llmsTxtUrl: "https://react.dev/llms.txt",
        llmsFullTxtUrl: undefined as string | undefined,
        description: "UI library",
        githubUrl: "https://github.com/facebook/react",
        aliases: ["react"],
        language: ["javascript"],
        tags: ["ui"],
      };
      vi.mocked(fuzzySearch).mockReturnValue([reactEntry]);
      vi.mocked(lookupById).mockReturnValue(reactEntry);
      await handler({ query: "React hooks best practices" });
      expect(fuzzySearch).toHaveBeenCalledWith("React hooks best practices", 3);
    });

    it("includes registry result in response when content is >200 chars", async () => {
      const reactEntry = {
        id: "facebook/react",
        name: "React",
        docsUrl: "https://react.dev",
        llmsTxtUrl: "https://react.dev/llms.txt",
        llmsFullTxtUrl: undefined as string | undefined,
        description: "UI library",
        githubUrl: "https://github.com/facebook/react",
        aliases: ["react"],
        language: ["javascript"],
        tags: ["ui"],
      };
      vi.mocked(fuzzySearch).mockReturnValue([reactEntry]);
      vi.mocked(lookupById).mockReturnValue(reactEntry);
      // Content must actually cover the query — the registry stage now applies
      // the same evidence gate as every other sourcing stage.
      vi.mocked(fetchDocs).mockResolvedValue(
        makeFetchResult(
          "## React hooks\nReact hooks let you use state. Rules of hooks: call hooks at the top level. ".repeat(6),
        ),
      );
      const result = await handler({ query: "React hooks best practices" });
      expect(result.content[0]!.text).toContain("React");
      expect(result.structuredContent?.sources).toHaveLength(1);
    });

    it("skips registry match when lookupById returns null", async () => {
      vi.mocked(fuzzySearch).mockReturnValue([{ id: "some/lib", name: "SomeLib" } as never]);
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ query: "SomeLib usage" });
      expect(fetchDocs).not.toHaveBeenCalled();
    });

    it("skips registry match when fetchDocs throws", async () => {
      const entry = {
        id: "test/lib",
        name: "TestLib",
        docsUrl: "https://test.dev",
        llmsTxtUrl: undefined as string | undefined,
        llmsFullTxtUrl: undefined as string | undefined,
        description: "Test lib",
        githubUrl: undefined as string | undefined,
        aliases: ["testlib"],
        language: ["javascript"],
        tags: [],
      };
      vi.mocked(fuzzySearch).mockReturnValue([entry]);
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("fetch failed"));
      // docCache.get returns undefined so fetchAsMarkdownRace will be called for topic fallback
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(null);
      const result = await handler({ query: "TestLib usage patterns" });
      // Should not crash, should continue to other paths
      expect(result.content[0]!.text).toBeDefined();
    });

  });
});
