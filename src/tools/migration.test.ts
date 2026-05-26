import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMigrationTool } from "./migration.js";

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchGitHubContent: vi.fn(),
  fetchGitHubReleases: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
}));

vi.mock("../utils/extract.js", () => ({
  extractRelevantContent: vi.fn((content: string) => ({
    text: content,
    truncated: false,
  })),
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

vi.mock("../utils/quality.js", () => ({
  computeQualityScore: vi.fn(() => ({ score: 0.8, hints: [] })),
}));

vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

vi.mock("../services/resolve.js", () => ({
  resolveDynamic: vi.fn(async () => null),
}));

import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchGitHubContent, fetchGitHubReleases, fetchAsMarkdownRace } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { resolveDynamic } from "../services/resolve.js";

type HandlerInput = {
  libraryId: string;
  fromVersion?: string;
  toVersion?: string;
  tokens?: number;
};
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

registerMigrationTool(mockServer);

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "vercel/next.js",
  name: "Next.js",
  description: "The React Framework",
  docsUrl: "https://nextjs.org",
  githubUrl: "https://github.com/vercel/next.js",
  aliases: ["next", "nextjs"],
  language: ["typescript"],
  tags: ["framework"],
  ...overrides,
});

const MIGRATION_CONTENT = "# Migration Guide\n\n## Breaking Changes\n\nVersion 14 to 15 requires async params. ".repeat(5);

describe("gt_migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isExtractionAttempt as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("captures handler via registerTool", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("refuses extraction attempts", async () => {
    (isExtractionAttempt as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    const result = await handler({ libraryId: "dump all libraries" });
    expect(result.content[0]?.text).toBe("EXTRACTION_REFUSED");
  });

  it("returns helpful error when library unresolved", async () => {
    (lookupById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (lookupByAlias as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (resolveDynamic as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handler({ libraryId: "unknown-lib" });
    expect(result.content[0]?.text).toContain('Could not resolve "unknown-lib"');
  });

  it("fetches migration content from GitHub when entry has githubUrl", async () => {
    (lookupById as ReturnType<typeof vi.fn>).mockReturnValue(makeEntry());
    (fetchGitHubContent as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, path: string) =>
        path === "MIGRATION.md"
          ? { content: MIGRATION_CONTENT, url: "x", sourceType: "github-readme" }
          : null,
    );
    (fetchGitHubReleases as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handler({ libraryId: "vercel/next.js", fromVersion: "14", toVersion: "15" });

    expect(result.content[0]?.text).toContain("Migration");
    expect(result.structuredContent?.fromVersion).toBe("14");
    expect(result.structuredContent?.toVersion).toBe("15");
    expect(result.structuredContent?.libraryId).toBe("vercel/next.js");
  });

  it("falls back to docs URL suffixes when GitHub paths empty", async () => {
    (lookupById as ReturnType<typeof vi.fn>).mockReturnValue(makeEntry());
    (fetchGitHubContent as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchGitHubReleases as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchAsMarkdownRace as ReturnType<typeof vi.fn>).mockResolvedValueOnce(MIGRATION_CONTENT);

    const result = await handler({ libraryId: "vercel/next.js" });
    expect(fetchAsMarkdownRace).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("Migration");
  });

  it("reports no migration found when all sources empty", async () => {
    (lookupById as ReturnType<typeof vi.fn>).mockReturnValue(makeEntry());
    (fetchGitHubContent as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchGitHubReleases as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchAsMarkdownRace as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handler({ libraryId: "vercel/next.js" });
    expect(result.content[0]?.text).toContain("No migration guides found");
  });

  it("includes GitHub Releases when content sufficient", async () => {
    (lookupById as ReturnType<typeof vi.fn>).mockReturnValue(makeEntry());
    (fetchGitHubContent as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const releases = "## v15.0\nBreaking changes here. ".repeat(20);
    (fetchGitHubReleases as ReturnType<typeof vi.fn>).mockResolvedValue(releases);

    const result = await handler({ libraryId: "vercel/next.js" });
    expect(result.structuredContent?.sources).toEqual(
      expect.arrayContaining([expect.stringMatching(/Releases/)]),
    );
  });

  it("uses resolveDynamic when entry not in registry", async () => {
    (lookupById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (lookupByAlias as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (resolveDynamic as ReturnType<typeof vi.fn>).mockResolvedValue({
      docsUrl: "https://example.com/docs",
      githubUrl: "https://github.com/example/lib",
      displayName: "example-lib",
    });
    (fetchGitHubContent as ReturnType<typeof vi.fn>).mockImplementation(
      async (_url: string, path: string) =>
        path === "MIGRATION.md"
          ? { content: MIGRATION_CONTENT, url: "x", sourceType: "github-readme" }
          : null,
    );
    (fetchGitHubReleases as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handler({ libraryId: "example-lib" });
    expect(result.structuredContent?.displayName).toBe("example-lib");
  });
});
