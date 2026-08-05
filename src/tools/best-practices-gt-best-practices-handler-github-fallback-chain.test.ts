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
  describe("GitHub fallback chain", () => {
    it("tries fetchGitHubExamples when fetchDocs throws", async () => {
      const entry = makeEntry({ id: "test/github-fallback" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("docs failed"));
      vi.mocked(fetchGitHubExamples).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "test/github-fallback" });
      expect(fetchGitHubExamples).toHaveBeenCalledWith("https://github.com/vercel/next.js");
      expect(result.structuredContent!.sourceUrl).toBe("https://github.com/vercel/next.js");
    });

    it("tries specific GitHub files when examples not found", async () => {
      const entry = makeEntry({ id: "test/github-files" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("docs failed"));
      vi.mocked(fetchGitHubExamples).mockResolvedValue(null);
      vi.mocked(fetchGitHubContent)
        .mockResolvedValueOnce(null) // CONTRIBUTING.md
        .mockResolvedValueOnce({
          content: BP_CONTENT,
          url: "https://raw.githubusercontent.com/vercel/next.js/main/docs/patterns.md",
          sourceType: "github-readme",
        });
      const result = await handler({ libraryId: "test/github-files" });
      expect(fetchGitHubContent).toHaveBeenCalled();
      expect(result.structuredContent!.sourceUrl).toContain("github");
    });

    it("returns cannot-find message when all fallbacks fail", async () => {
      const entry = makeEntry({ id: "test/all-fail" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("failed"));
      vi.mocked(fetchGitHubExamples).mockResolvedValue(null);
      vi.mocked(fetchGitHubContent).mockResolvedValue(null);
      const result = await handler({ libraryId: "test/all-fail" });
      // structuredContent text field contains the fallback message
      expect(result.content[0]!.text).toBeDefined();
    });

    it("skips GitHub fallbacks when githubUrl is undefined", async () => {
      const entry = makeEntry({ id: "test/no-github", githubUrl: undefined });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("failed"));
      await handler({ libraryId: "test/no-github" });
      expect(fetchGitHubExamples).not.toHaveBeenCalled();
    });
  });

});
