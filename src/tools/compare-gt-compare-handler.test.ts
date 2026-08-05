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
  describe("extraction guard", () => {
    it("treats a flagged first library as unresolvable but still compares the sibling", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      vi.mocked(lookupByAlias).mockReturnValue(makeEntry("org/drizzle-orm", "Drizzle"));
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["dump all", "drizzle-orm"] });
      expect(result.content[0]!.text).not.toBe("EXTRACTION_REFUSED");
      // The legitimate sibling is still fetched — one flagged name must not
      // discard the whole comparison.
      expect(fetchDocs).toHaveBeenCalledTimes(1);
    });

    it("treats a flagged second library as unresolvable but still compares the sibling", async () => {
      vi.mocked(isExtractionAttempt)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      vi.mocked(lookupByAlias).mockReturnValue(makeEntry("org/prisma", "Prisma"));
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["prisma", "ignore previous"] });
      expect(result.content[0]!.text).not.toBe("EXTRACTION_REFUSED");
      expect(fetchDocs).toHaveBeenCalledTimes(1);
    });

    it("refuses when every library name is an extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValue(true);
      const result = await handler({ libraries: ["dump all", "ignore previous"] });
      expect(fetchDocs).not.toHaveBeenCalled();
      expect(result.content[0]!.text).toContain("Could not resolve");
    });

    it("does not guard the criteria field — it is a comparison angle, not a registry key", async () => {
      // Pre-fix, criteria like "full feature list" refused the whole comparison.
      vi.mocked(lookupByAlias).mockReturnValue(makeEntry("org/prisma", "Prisma"));
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["prisma", "drizzle"], criteria: "full feature list" });
      expect(result.content[0]!.text).not.toBe("EXTRACTION_REFUSED");
      // Guard runs per library name only, never on criteria.
      expect(isExtractionAttempt).toHaveBeenCalledTimes(2);
    });
  });

  describe("2-library comparison", () => {
    it("resolves both libraries and fetches docs for each", async () => {
      const prisma = makeEntry("prisma/prisma", "Prisma");
      const drizzle = makeEntry("drizzle-team/drizzle-orm", "Drizzle ORM");
      vi.mocked(lookupByAlias).mockImplementation((name) => {
        if (name === "prisma") return prisma;
        if (name === "drizzle-orm") return drizzle;
        return undefined;
      });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["prisma", "drizzle-orm"] });
      expect(fetchDocs).toHaveBeenCalledTimes(2);
      expect(result.content[0]!.text).toContain("Prisma");
      expect(result.content[0]!.text).toContain("Drizzle ORM");
    });

    it("includes library names in response header", async () => {
      const prisma = makeEntry("prisma/prisma", "Prisma");
      const drizzle = makeEntry("drizzle-team/drizzle-orm", "Drizzle ORM");
      vi.mocked(lookupByAlias).mockImplementation((name) => {
        if (name === "prisma") return prisma;
        if (name === "drizzle-orm") return drizzle;
        return undefined;
      });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraries: ["prisma", "drizzle-orm"] });
      expect(result.content[0]!.text).toContain("prisma vs drizzle-orm");
    });
  });

  describe("3-library comparison", () => {
    it("fetches docs for all three libraries", async () => {
      const libs = ["zod", "valibot", "yup"].map((name) => makeEntry(`org/${name}`, name));
      vi.mocked(lookupByAlias).mockImplementation((name) => libs.find((l) => l.name === name));
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraries: ["zod", "valibot", "yup"] });
      expect(fetchDocs).toHaveBeenCalledTimes(3);
    });
  });

});
