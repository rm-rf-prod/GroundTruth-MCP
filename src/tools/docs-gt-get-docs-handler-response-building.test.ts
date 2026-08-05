import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocsTool } from "./docs.js";

// ── Dependency mocks ────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchGitHubContent: vi.fn(),
  fetchViaJina: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  // Mirror of the real implementation — the index-content gate under test
  // depends on it (relative links count too).
  isIndexContent: (content: string) => {
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 5) return false;
    const linkLines = lines.filter((l) => /^\s*-?\s*\[.+\]\((?:https?:\/\/|\/)[^)]+\)/.test(l));
    return linkLines.length / lines.length > 0.5;
  },
}));

vi.mock("../services/deep-fetch.js", () => ({
  deepFetchForTopic: vi.fn(async (result: unknown) => result),
  splitTopics: vi.fn((topic: string) => [topic]),
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
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
  assertPublicUrl: vi.fn(),
}));

vi.mock("../utils/quality.js", () => ({
  computeQualityScore: vi.fn(() => ({ score: 0.8, hints: [] })),
}));

vi.mock("../services/resolve.js", () => ({
  probeLlmsTxt: vi.fn(async () => ({})),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchViaJina, fetchAsMarkdownRace } from "../services/fetcher.js";
import { deepFetchForTopic } from "../services/deep-fetch.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt } from "../utils/guard.js";

// ── Handler capture ─────────────────────────────────────────────────────────

type HandlerInput = { libraryId: string; topic?: string; version?: string; tokens?: number };
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

registerDocsTool(mockServer);

// ── Helpers ─────────────────────────────────────────────────────────────────

const DOCS_CONTENT = "Documentation content here.\n".repeat(20);

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "facebook/react",
  name: "React",
  description: "A JavaScript library for building user interfaces",
  docsUrl: "https://react.dev",
  llmsTxtUrl: "https://react.dev/llms.txt",
  llmsFullTxtUrl: undefined as string | undefined,
  githubUrl: "https://github.com/facebook/react",
  ...overrides,
});

const makeFetchResult = (content = DOCS_CONTENT, sourceType = "llms-txt" as const, url = "https://react.dev/llms.txt") => ({
  content,
  sourceType,
  url,
});

beforeEach(() => {
  vi.mocked(lookupById).mockReset();
  vi.mocked(lookupByAlias).mockReset();
  vi.mocked(fetchDocs).mockReset();
  vi.mocked(fetchGitHubContent).mockReset();
  vi.mocked(fetchViaJina).mockReset().mockResolvedValue(null);
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(null);
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(deepFetchForTopic).mockReset().mockImplementation(async (result) => result);
  vi.mocked(sanitizeContent).mockReset().mockImplementation((t: string) => t);
  vi.mocked(extractRelevantContent).mockImplementation((content, _topic, _tokens) => ({
    text: content,
    truncated: false,
  }));
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("gt_get_docs handler", () => {
  describe("response building", () => {
    it("wraps response in withNotice", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toMatch(/^NOTICE/);
    });

    it("includes library name in header", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toContain("React Documentation");
    });

    it("includes source type in header", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toContain("llms-txt");
    });

    it("includes topic in header when provided", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "facebook/react", topic: "hooks" });
      expect(result.content[0]!.text).toContain("hooks");
    });

    it("includes truncation notice when content is truncated", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      vi.mocked(extractRelevantContent).mockReturnValue({ text: "...", truncated: true });
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toContain("truncated");
    });

    it("returns structuredContent with correct fields", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "facebook/react", topic: "state" });
      const sc = result.structuredContent!;
      expect(sc).toMatchObject({
        libraryId: "facebook/react",
        displayName: "React",
        topic: "state",
        sourceUrl: "https://react.dev/llms.txt",
        sourceType: "llms-txt",
        truncated: false,
      });
    });

    it("calls extractRelevantContent with the tokens value", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "facebook/react", tokens: 5000 });
      expect(extractRelevantContent).toHaveBeenCalledWith(expect.any(String), expect.any(String), 5000);
    });

    it("uses default token limit when tokens not provided", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "facebook/react" });
      expect(extractRelevantContent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Number),
      );
    });
  });

});
