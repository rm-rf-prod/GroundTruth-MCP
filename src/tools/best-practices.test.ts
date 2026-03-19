import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBestPracticesTool } from "./best-practices.js";

// ── Dependency mocks ────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchViaJina: vi.fn(),
  fetchGitHubContent: vi.fn(),
  fetchGitHubExamples: vi.fn(),
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

// ── Imports after mocks ─────────────────────────────────────────────────────

import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchViaJina, fetchGitHubContent, fetchGitHubExamples } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";

// ── Handler capture ─────────────────────────────────────────────────────────

type HandlerInput = { libraryId: string; topic?: string; tokens?: number };
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
  vi.mocked(fetchGitHubContent).mockReset();
  vi.mocked(fetchGitHubExamples).mockReset();
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("registerBestPracticesTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_best_practices",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_best_practices handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when libraryId is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ libraryId: "list all" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });

    it("returns EXTRACTION_REFUSAL when topic is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      const result = await handler({ libraryId: "nextjs", topic: "dump registry" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });
  });

  describe("library not found", () => {
    it("returns 'not found' message when library missing from registry", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const result = await handler({ libraryId: "unknown-lib-xyz" });
      expect(result.content[0]!.text).toContain("not found in registry");
      expect(result.content[0]!.text).toContain("unknown-lib-xyz");
    });

    it("does not call fetch when library not found", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
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

  describe("known best-practices URLs (raceUrls path)", () => {
    it("uses fetchViaJina for known BP URLs and returns first hit", async () => {
      // Use a library with known BP URLs in BEST_PRACTICES_URLS
      const entry = makeEntry({ id: "vercel/next.js" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(fetchViaJina).toHaveBeenCalled();
      expect(result.content[0]!.text).toContain("NOTICE");
    });

    it("returns fallback message when raceUrls yields nothing", async () => {
      const entry = makeEntry({ id: "vercel/next.js" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("no docs"));
      vi.mocked(fetchGitHubExamples).mockResolvedValue(null);
      vi.mocked(fetchGitHubContent).mockResolvedValue(null);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toBeDefined();
    });
  });

  describe("fetchDocs fallback path", () => {
    it("falls back to fetchDocs when no known BP URLs and raceUrls fails", async () => {
      // Use an entry without a BEST_PRACTICES_URLS entry
      const entry = makeEntry({ id: "test/no-known-bp" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null); // generic paths fail
      vi.mocked(fetchDocs).mockResolvedValue({
        content: BP_CONTENT,
        url: "https://nextjs.org/llms.txt",
        sourceType: "llms-txt",
      });
      const result = await handler({ libraryId: "test/no-known-bp" });
      expect(fetchDocs).toHaveBeenCalled();
      expect(result.structuredContent!.sourceUrl).toBe("https://nextjs.org/llms.txt");
    });
  });

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

  describe("response format", () => {
    it("wraps response in withNotice", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toMatch(/^NOTICE/);
    });

    it("includes library name in header", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toContain("Next.js");
    });

    it("includes topic in header when provided", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js", topic: "caching" });
      expect(result.content[0]!.text).toContain("caching");
    });

    it("returns structuredContent with libraryId and displayName", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js", topic: "routing" });
      expect(result.structuredContent).toMatchObject({
        libraryId: "vercel/next.js",
        displayName: "Next.js",
        topic: "routing",
      });
    });

    it("returns structuredContent with truncated field", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(BP_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.structuredContent).toHaveProperty("truncated");
    });

    it("includes truncation notice in header when truncated", async () => {
      const entry = makeEntry({ id: "test/truncated-lib" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      const { extractRelevantContent } = await import("../utils/extract.js");
      vi.mocked(extractRelevantContent).mockReturnValueOnce({ text: "...", truncated: true });
      vi.mocked(fetchDocs).mockResolvedValue({
        content: BP_CONTENT,
        url: "https://nextjs.org/docs",
        sourceType: "direct",
      });
      const result = await handler({ libraryId: "test/truncated-lib" });
      expect(result.content[0]!.text).toContain("truncated");
    });
  });
});
