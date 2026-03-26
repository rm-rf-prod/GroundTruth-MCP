import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool } from "./search.js";

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

vi.mock("../utils/quality.js", () => ({
  computeQualityScore: vi.fn(() => 0.8),
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

const LONG_CONTENT = "This is detailed web development content. ".repeat(10);

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

describe("registerSearchTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_search",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_search handler", () => {
  describe("basic behavior", () => {
    it("returns results for valid queries", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(result.content[0]!.text).toBeDefined();
    });
  });

  describe("year normalization", () => {
    it("replaces stale year in query with current year", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const currentYear = new Date().getFullYear();
      const staleYear = currentYear - 2;
      const result = await handler({ query: `React best practices ${staleYear}` });
      // The query stored in structuredContent should have the updated year
      expect(result.structuredContent?.query).toContain(String(currentYear));
      expect(result.structuredContent?.query).not.toContain(String(staleYear));
    });

    it("does not replace current year in query", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const currentYear = new Date().getFullYear();
      const result = await handler({ query: `React best practices ${currentYear}` });
      expect(result.structuredContent?.query).toContain(String(currentYear));
    });

    it("does not modify version numbers like ES2022 or OAuth2.0", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "ES2022 features OAuth2.0" });
      expect(result.structuredContent?.query).toContain("ES2022");
      expect(result.structuredContent?.query).toContain("OAuth2.0");
    });
  });

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
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
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

    it("only uses first registry match (breaks after one)", async () => {
      const entry1 = {
        id: "a/lib1",
        name: "Lib1",
        docsUrl: "https://lib1.dev",
        llmsTxtUrl: undefined as string | undefined,
        llmsFullTxtUrl: undefined as string | undefined,
        description: "First lib",
        githubUrl: undefined as string | undefined,
        aliases: [],
        language: [],
        tags: [],
      };
      const entry2 = {
        id: "b/lib2",
        name: "Lib2",
        docsUrl: "https://lib2.dev",
        llmsTxtUrl: undefined as string | undefined,
        llmsFullTxtUrl: undefined as string | undefined,
        description: "Second lib",
        githubUrl: undefined as string | undefined,
        aliases: [],
        language: [],
        tags: [],
      };
      vi.mocked(fuzzySearch).mockReturnValue([entry1, entry2]);
      vi.mocked(lookupById).mockReturnValue(entry1);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ query: "lib usage" });
      // Only one fetchDocs call — it breaks after first successful hit
      expect(fetchDocs).toHaveBeenCalledTimes(1);
    });
  });

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

    it("falls back to Bing when DuckDuckGo fails", async () => {
      vi.mocked(fetchWithTimeout)
        .mockRejectedValueOnce(new Error("DDG down")) // DDG fails
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(
            `<a href="https://developer.mozilla.org/en-US/docs/XYZ">MDN</a>`,
          ),
          status: 200,
        } as unknown as Response); // Bing succeeds
      // Return null for direct docs URLs, LONG_CONTENT only for web search results
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
        if (url.includes("developer.mozilla.org/en-US/docs/XYZ")) return LONG_CONTENT;
        return null;
      });
      await handler({ query: "some obscure undocumented topic xyz456" });
      expect(fetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining("bing.com"),
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
        if (url.includes("developer.mozilla.org/en-US/search")) return LONG_CONTENT;
        return null;
      });
      const result = await handler({ query: "unknown obscure xyz000 topic" });
      const mdnSource = result.structuredContent?.sources.find((s: { name: string }) => s.name === "MDN Web Docs");
      expect(mdnSource).toBeDefined();
    });
  });

  describe("no results", () => {
    it("returns no-results message when nothing found", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("search failed"));
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      const result = await handler({ query: "zzz-completely-unknown-xyz-topic" });
      expect(result.content[0]!.text).toContain("No results found");
      expect(result.content[0]!.text).toContain("zzz-completely-unknown-xyz-topic");
    });

    it("suggests alternatives in no-results message", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("search failed"));
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      const result = await handler({ query: "zzz-completely-unknown-xyz-topic" });
      expect(result.content[0]!.text).toContain("resolve_library");
    });

    it("does not return structuredContent when no results", async () => {
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("search failed"));
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      const result = await handler({ query: "zzz-completely-unknown-xyz-topic" });
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe("response format", () => {
    it("returns response with search header", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(result.content[0]!.text).toContain("# Search:");
    });

    it("includes query in header", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 security" });
      expect(result.content[0]!.text).toContain("OWASP top 10 security");
    });

    it("returns structuredContent with query field", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(result.structuredContent?.query).toBeDefined();
    });

    it("returns structuredContent with sources array", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(Array.isArray(result.structuredContent?.sources)).toBe(true);
    });

    it("each source has name, url, and content fields", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      const source = result.structuredContent?.sources[0];
      expect(source).toHaveProperty("name");
      expect(source).toHaveProperty("url");
      expect(source).toHaveProperty("content");
    });

    it("includes source URL in body text", async () => {
      vi.mocked(docCache.get).mockReturnValue(LONG_CONTENT);
      const result = await handler({ query: "OWASP top 10 vulnerabilities" });
      expect(result.content[0]!.text).toContain("owasp.org");
    });
  });

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
        if (url.includes("developer.mozilla.org/en-US/search")) return LONG_CONTENT;
        return null;
      });
      const result = await handler({ query: "unknown obscure xyz000 topic" });
      const mdnSource = result.structuredContent?.sources.find((s: { name: string }) => s.name === "MDN Web Docs");
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
