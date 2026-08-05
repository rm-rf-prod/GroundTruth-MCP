import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCompareTool } from "./compare.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
  fuzzySearch: vi.fn(() => []),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchViaJina: vi.fn().mockResolvedValue(null),
  fetchAsMarkdownRace: vi.fn().mockResolvedValue(null),
  isIndexContent: vi.fn().mockReturnValue(false),
  rankIndexLinks: vi.fn().mockReturnValue([]),
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

// ── Imports after mocks ──────────────────────────────────────────────────────

import { lookupById, lookupByAlias, fuzzySearch } from "../sources/registry.js";
import { fetchDocs, fetchViaJina, fetchAsMarkdownRace, isIndexContent, rankIndexLinks } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { extractRelevantContent } from "../utils/extract.js";

// ── Handler capture ──────────────────────────────────────────────────────────

type HandlerInput = { libraries: string[]; criteria?: string; tokens?: number };
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

registerCompareTool(mockServer);

// ── Helpers ──────────────────────────────────────────────────────────────────

const DOCS_CONTENT = "Documentation content for the library.\n".repeat(20);

const makeEntry = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  aliases: [name.toLowerCase()],
  description: `${name} is a great library`,
  docsUrl: `https://${name.toLowerCase()}.dev/docs`,
  llmsTxtUrl: `https://${name.toLowerCase()}.dev/llms.txt`,
  llmsFullTxtUrl: undefined as string | undefined,
  githubUrl: `https://github.com/org/${name.toLowerCase()}`,
  language: ["typescript"],
  tags: ["library"],
  ...overrides,
});

const makeFetchResult = (content = DOCS_CONTENT) => ({
  content,
  sourceType: "llms-txt" as const,
  url: "https://example.dev/llms.txt",
});

beforeEach(() => {
  vi.mocked(lookupById).mockReset().mockReturnValue(undefined);
  vi.mocked(lookupByAlias).mockReset().mockReturnValue(undefined);
  vi.mocked(fuzzySearch).mockReset().mockReturnValue([]);
  vi.mocked(fetchDocs).mockReset();
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(docCache.get).mockReset().mockReturnValue(undefined);
  vi.mocked(docCache.set).mockReset();
  vi.mocked(extractRelevantContent).mockReset().mockImplementation((content, _topic, _tokens) => ({
    text: content,
    truncated: false,
  }));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("gt_compare handler", () => {
  describe("response format", () => {
    it("wraps response in withNotice", async () => {
      const lib = makeEntry("prisma/prisma", "Prisma");
      vi.mocked(lookupByAlias).mockReturnValue(lib);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["prisma", "drizzle-orm"] });
      expect(result.content[0]!.text).toMatch(/^NOTICE/);
    });

    it("returns structuredContent with libraries array and criteria", async () => {
      const prisma = makeEntry("prisma/prisma", "Prisma");
      const drizzle = makeEntry("drizzle-team/drizzle-orm", "Drizzle ORM");
      vi.mocked(lookupByAlias).mockImplementation((name) => {
        if (name === "prisma") return prisma;
        if (name === "drizzle-orm") return drizzle;
        return undefined;
      });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["prisma", "drizzle-orm"], criteria: "DX" });
      expect(result.structuredContent).toMatchObject({ criteria: "DX" });
      expect(Array.isArray(result.structuredContent?.libraries)).toBe(true);
    });
  });

  describe("cache hit", () => {
    it("uses cached docs without re-fetching", async () => {
      const lib = makeEntry("prisma/prisma", "Prisma");
      vi.mocked(lookupByAlias).mockReturnValue(lib);
      vi.mocked(docCache.get).mockReturnValue("CACHED_DOCS");
      await handler({ libraries: ["prisma", "drizzle-orm"] });
      expect(fetchDocs).not.toHaveBeenCalled();
    });
  });

  describe("deep link follow", () => {
    it("follows deep links when library docs is an index page", async () => {
      const prisma = makeEntry("prisma/prisma", "Prisma");
      const drizzle = makeEntry("drizzle-team/drizzle-orm", "Drizzle ORM");
      vi.mocked(lookupByAlias).mockImplementation((name) => {
        if (name === "prisma") return prisma;
        if (name === "drizzle-orm") return drizzle;
        return undefined;
      });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      vi.mocked(isIndexContent).mockReturnValueOnce(true).mockReturnValue(false);
      vi.mocked(rankIndexLinks).mockReturnValueOnce(["https://example.com/deep"]).mockReturnValue([]);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("y".repeat(400));
      const result = await handler({ libraries: ["prisma", "drizzle-orm"], criteria: "test" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith("https://example.com/deep");
      expect(result.content[0]!.text).toBeDefined();
    });
  });

  describe("parameterized: known library pairs", () => {
    it.each([
      [["prisma", "drizzle-orm"]],
      [["trpc", "hono"]],
      [["zod", "valibot"]],
    ])("handles comparison: %s", async (libraries) => {
      const entries = libraries.map((name) => makeEntry(`org/${name}`, name));
      vi.mocked(lookupByAlias).mockImplementation((name) => entries.find((e) => e.name === name));
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries });
      expect(result.content[0]!.text).toBeDefined();
    });
  });
});
