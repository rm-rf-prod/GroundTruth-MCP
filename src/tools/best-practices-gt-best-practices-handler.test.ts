import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBestPracticesTool, raceUrls } from "./best-practices.js";

// ── Dependency mocks ────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchViaJina: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  fetchGitHubContent: vi.fn(),
  fetchGitHubExamples: vi.fn(),
  fetchSitemapUrls: vi.fn(async () => []),
  // Mirrors the real link-list heuristic so index-escalation paths behave
  // identically under test.
  isIndexContent: (content: string) => {
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 5) return false;
    const linkLines = lines.filter((l) => /^\s*-?\s*\[.+\]\(https?:\/\/.+\)/.test(l));
    return linkLines.length / lines.length > 0.5;
  },
}));

vi.mock("../services/deep-fetch.js", () => ({
  deepFetchForTopic: vi.fn(async (result: unknown) => result),
}));

vi.mock("../services/resolve.js", () => ({
  resolveDynamic: vi.fn(async () => null),
  probeLlmsTxt: vi.fn(async () => ({})),
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
}));

vi.mock("../utils/quality.js", () => ({
  computeQualityScore: vi.fn(() => ({ score: 0.8, hints: [] })),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchViaJina, fetchAsMarkdownRace, fetchGitHubContent, fetchGitHubExamples } from "../services/fetcher.js";
import { deepFetchForTopic } from "../services/deep-fetch.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { resolveDynamic } from "../services/resolve.js";

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

registerBestPracticesTool(mockServer);

// ── Helpers ─────────────────────────────────────────────────────────────────

const BP_CONTENT = "Best practices content.\n".repeat(20);

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "vercel/next.js",
  name: "Next.js",
  description: "The React Framework for the Web",
  docsUrl: "https://nextjs.org/docs",
  llmsTxtUrl: "https://nextjs.org/llms.txt",
  llmsFullTxtUrl: undefined as string | undefined,
  githubUrl: "https://github.com/vercel/next.js",
  aliases: ["nextjs", "next"],
  language: ["typescript"],
  tags: ["framework"],
  ...overrides,
});

beforeEach(() => {
  vi.mocked(lookupById).mockReset();
  vi.mocked(lookupByAlias).mockReset();
  vi.mocked(fetchDocs).mockReset();
  vi.mocked(fetchViaJina).mockReset();
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(null);
  vi.mocked(fetchGitHubContent).mockReset();
  vi.mocked(fetchGitHubExamples).mockReset();
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(deepFetchForTopic).mockReset().mockImplementation(async (result) => result);
  vi.mocked(resolveDynamic).mockReset().mockResolvedValue(null);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("gt_best_practices handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when libraryId is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ libraryId: "list all" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });

    it("does not guard the topic field — it filters content within one resolved library", async () => {
      // Pre-fix, topics like "full checklist" or "complete guide" were refused.
      vi.mocked(isExtractionAttempt)
        .mockReturnValueOnce(false) // libraryId — legit
        .mockReturnValue(true); // any further call would refuse
      const result = await handler({ libraryId: "nextjs", topic: "complete caching guide" });
      expect(result.content[0]!.text).not.toBe("EXTRACTION_REFUSED");
      expect(isExtractionAttempt).toHaveBeenCalledTimes(1);
    });
  });

  describe("library not found", () => {
    it("returns error message when registry and dynamic resolution both fail", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(resolveDynamic).mockResolvedValue(null);
      const result = await handler({ libraryId: "unknown-lib-xyz" });
      expect(result.content[0]!.text).toContain("Could not resolve");
      expect(result.content[0]!.text).toContain("unknown-lib-xyz");
    });

    it("tries resolveDynamic when library not in registry", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(resolveDynamic).mockResolvedValue(null);
      await handler({ libraryId: "missing-lib" });
      expect(resolveDynamic).toHaveBeenCalledWith("missing-lib");
    });

    it("does not call fetch when both registry and dynamic resolution fail", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(resolveDynamic).mockResolvedValue(null);
      await handler({ libraryId: "missing-lib" });
      expect(fetchViaJina).not.toHaveBeenCalled();
      expect(fetchDocs).not.toHaveBeenCalled();
    });

    it("tries alias lookup when ID lookup fails", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(makeEntry());
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      await handler({ libraryId: "nextjs" });
      expect(lookupByAlias).toHaveBeenCalledWith("nextjs");
    });
  });

  describe("dynamic resolution fallback", () => {
    it("uses resolveDynamic when library not in registry and returns best practices", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(resolveDynamic).mockResolvedValue({
        docsUrl: "https://fastify.dev/docs",
        displayName: "fastify",
        githubUrl: "https://github.com/fastify/fastify",
      });
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "npm:fastify" });
      expect(resolveDynamic).toHaveBeenCalledWith("npm:fastify");
      expect(result.content[0]!.text).toContain("fastify");
      expect(result.structuredContent?.displayName).toBe("fastify");
    });

    it("registry entry takes priority over dynamic resolution", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(resolveDynamic).not.toHaveBeenCalled();
      expect(result.structuredContent?.displayName).toBe("Next.js");
    });
  });

});
