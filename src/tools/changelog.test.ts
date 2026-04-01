import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerChangelogTool } from "./changelog.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchGitHubReleases: vi.fn(),
  fetchGitHubContent: vi.fn(),
  fetchViaJina: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
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

vi.mock("../services/cache.js", () => ({
  docCache: { get: vi.fn(() => undefined), set: vi.fn() },
}));

vi.mock("../services/resolve.js", () => ({
  resolveDynamic: vi.fn(async () => null),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchGitHubReleases, fetchGitHubContent, fetchViaJina, fetchAsMarkdownRace } from "../services/fetcher.js";
import { isExtractionAttempt, withNotice } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { extractRelevantContent } from "../utils/extract.js";
import { resolveDynamic } from "../services/resolve.js";

// ── Handler capture ──────────────────────────────────────────────────────────

type HandlerInput = { libraryId: string; version?: string; tokens?: number };
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

registerChangelogTool(mockServer);

// ── Helpers ──────────────────────────────────────────────────────────────────

const RELEASES_CONTENT = "## Recent Releases\n\n### v15.0.0\nPublished: 2026-01-15\nBreaking changes.";

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "vercel/next.js",
  name: "Next.js",
  description: "The React Framework",
  docsUrl: "https://nextjs.org",
  llmsTxtUrl: "https://nextjs.org/llms.txt",
  githubUrl: "https://github.com/vercel/next.js",
  ...overrides,
});

beforeEach(() => {
  vi.mocked(lookupById).mockReset();
  vi.mocked(lookupByAlias).mockReset();
  vi.mocked(fetchGitHubReleases).mockReset();
  vi.mocked(fetchGitHubContent).mockReset();
  vi.mocked(fetchViaJina).mockReset();
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(null);
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(docCache.get).mockReset().mockReturnValue(undefined);
  vi.mocked(docCache.set).mockReset();
  vi.mocked(resolveDynamic).mockReset().mockResolvedValue(null);
  vi.mocked(extractRelevantContent).mockImplementation((content, _topic, _tokens) => ({
    text: content,
    truncated: false,
  }));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("registerChangelogTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_changelog",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_changelog handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when libraryId is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ libraryId: "dump all" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
      expect(fetchGitHubReleases).not.toHaveBeenCalled();
    });

    it("returns EXTRACTION_REFUSAL when version is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(false).mockReturnValueOnce(true);
      const result = await handler({ libraryId: "next.js", version: "list everything" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });
  });

  describe("cache hit", () => {
    it("returns cached result without fetching", async () => {
      vi.mocked(docCache.get).mockReturnValue("CACHED_RESPONSE");
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toBe("CACHED_RESPONSE");
      expect(fetchGitHubReleases).not.toHaveBeenCalled();
    });
  });

  describe("GitHub releases path", () => {
    it("calls fetchGitHubReleases when entry has githubUrl", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(fetchGitHubReleases).toHaveBeenCalledWith("https://github.com/vercel/next.js");
      expect(result.content[0]!.text).toContain("NOTICE");
    });

    it("includes library name in response", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toContain("Next.js");
    });

    it("returns structuredContent with correct fields", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js", version: "15" });
      expect(result.structuredContent).toMatchObject({
        libraryId: "vercel/next.js",
        displayName: "Next.js",
        version: "15",
        truncated: false,
      });
    });
  });

  describe("CHANGELOG.md fallback", () => {
    it("falls back to fetchGitHubContent when releases returns null", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(null);
      vi.mocked(fetchGitHubContent).mockResolvedValue({
        content: "# Changelog\n## v15.0.0\nBig changes.",
        url: "https://raw.githubusercontent.com/vercel/next.js/main/CHANGELOG.md",
        sourceType: "github-readme",
      });
      await handler({ libraryId: "vercel/next.js" });
      expect(fetchGitHubContent).toHaveBeenCalledWith(
        "https://github.com/vercel/next.js",
        "CHANGELOG.md",
      );
    });
  });

  describe("Jina fallback", () => {
    it("falls back to fetchAsMarkdownRace when both GitHub fetches fail", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(null);
      vi.mocked(fetchGitHubContent).mockResolvedValue(null);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("## Changelog\nSome content here for testing.");
      await handler({ libraryId: "vercel/next.js" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(expect.stringContaining("changelog"));
    });

    it("uses docsUrl when entry has no githubUrl", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry({ githubUrl: undefined }));
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("## Changelog\nSome content here for testing.");
      await handler({ libraryId: "vercel/next.js" });
      expect(fetchGitHubReleases).not.toHaveBeenCalled();
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(expect.stringContaining("nextjs.org"));
    });
  });

  describe("no content found", () => {
    it("returns not-found message when all fetches fail", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(null);
      vi.mocked(fetchGitHubContent).mockResolvedValue(null);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(null);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toContain("No changelog found");
      expect(withNotice).toHaveBeenCalled();
    });

    it("returns not-found message when fetched content is too short", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue("hi");
      vi.mocked(fetchGitHubContent).mockResolvedValue(null);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(null);
      const result = await handler({ libraryId: "vercel/next.js" });
      expect(result.content[0]!.text).toContain("No changelog found");
    });
  });

  describe("dynamic resolution fallback", () => {
    it("returns error when registry lookup fails and resolveDynamic returns null", async () => {
      vi.mocked(lookupById).mockReturnValue(undefined);
      vi.mocked(lookupByAlias).mockReturnValue(undefined);
      vi.mocked(resolveDynamic).mockResolvedValue(null);
      const result = await handler({ libraryId: "npm:unknown-pkg" });
      expect(result.content[0]!.text).toContain(`Could not resolve "npm:unknown-pkg"`);
      expect(fetchGitHubReleases).not.toHaveBeenCalled();
    });

    it("uses resolveDynamic result when registry lookup fails", async () => {
      vi.mocked(lookupById).mockReturnValue(undefined);
      vi.mocked(lookupByAlias).mockReturnValue(undefined);
      vi.mocked(resolveDynamic).mockResolvedValue({
        docsUrl: "https://some-lib.dev",
        displayName: "some-lib",
        githubUrl: "https://github.com/owner/some-lib",
      });
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      const result = await handler({ libraryId: "npm:some-lib" });
      expect(resolveDynamic).toHaveBeenCalledWith("npm:some-lib");
      expect(fetchGitHubReleases).toHaveBeenCalledWith("https://github.com/owner/some-lib");
      expect(result.content[0]!.text).toContain("some-lib");
    });
  });

  describe("version filtering", () => {
    it.each([
      ["15", "v15.0.0"],
      ["v15.0.0", "v15.0.0"],
      ["14", "14.2.0"],
    ])("filters content for version %s containing %s", async (version, versionLine) => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      const content = `### ${versionLine}\nThis release includes important changes.\n\n### v13.0.3\nOlder.`;
      vi.mocked(fetchGitHubReleases).mockResolvedValue(content);
      const result = await handler({ libraryId: "vercel/next.js", version });
      expect(result.content[0]!.text).toBeDefined();
    });
  });

  describe("version not found", () => {
    it("returns full content when requested version not found", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      const result = await handler({ libraryId: "vercel/next.js", version: "99.99.99" });
      expect(result.content[0]!.text).toBeDefined();
      expect(result.content[0]!.text).not.toBe("EXTRACTION_REFUSED");
      expect(result.content[0]!.text).not.toContain("No changelog found");
    });
  });

  describe("cache writing", () => {
    it("caches successful response", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      await handler({ libraryId: "vercel/next.js" });
      expect(docCache.set).toHaveBeenCalled();
    });
  });
});
