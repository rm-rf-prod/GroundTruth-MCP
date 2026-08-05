import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMigrationTool, filterReleasesByVersion } from "./migration.js";

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchGitHubContent: vi.fn(),
  fetchGitHubReleases: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
}));

vi.mock("../utils/extract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/extract.js")>()),
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
  withToolTimeout: async <T,>(fn: () => Promise<T>) => fn(),
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

vi.mock("../services/search/engines.js", () => ({
  webSearch: vi.fn(async () => []),
}));

vi.mock("../services/search/url-rank.js", () => ({
  isAuthoritativeUrl: vi.fn(() => false),
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

describe("web-search escalation (releases alone are not a migration guide)", () => {
  it("finds the official upgrade guide when only GitHub Releases matched", async () => {
    const { lookupById } = await import("../sources/registry.js");
    const { fetchGitHubContent, fetchGitHubReleases, fetchAsMarkdownRace } = await import("../services/fetcher.js");
    const { webSearch } = await import("../services/search/engines.js");

    vi.mocked(lookupById).mockReturnValue({
      id: "facebook/react", name: "React", aliases: ["react"],
      description: "", docsUrl: "https://react.dev", githubUrl: "https://github.com/facebook/react",
      language: ["javascript"], tags: [],
    } as never);
    vi.mocked(fetchGitHubContent).mockResolvedValue(null);
    vi.mocked(fetchGitHubReleases).mockResolvedValue(
      "## Recent Releases\n\n### v19.0.0\n\nupgrade migration breaking changes ".repeat(10),
    );
    vi.mocked(webSearch).mockResolvedValue([
      "https://react.dev/blog/2024/04/25/react-19-upgrade-guide",
    ]);
    vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) =>
      url === "https://react.dev/blog/2024/04/25/react-19-upgrade-guide"
        ? "# React 19 Upgrade Guide\n\nBreaking changes and upgrade migration steps. ".repeat(20)
        : null,
    );

    const result = await handler({ libraryId: "facebook/react", fromVersion: "18", toVersion: "19", tokens: 4000 });
    const sc = result.structuredContent as { sources?: string[] } | undefined;
    expect(sc?.sources?.[0]).toBe("https://react.dev/blog/2024/04/25/react-19-upgrade-guide");
    expect(vi.mocked(webSearch)).toHaveBeenCalled();
  });
});

// ── filterReleasesByVersion — release-please style sub-headers ────────────────

describe("filterReleasesByVersion", () => {
  it("keeps headerless ### sub-sections belonging to an in-band release", () => {
    const raw =
      "## Recent Releases\n" +
      "### v15.0.0\n\n" +
      "### Features\n- new streaming API\n\n" +
      "### v14.0.0\n\n" +
      "### Bug Fixes\n- old fix\n";
    const out = filterReleasesByVersion(raw, "15", "15");
    expect(out).toContain("### v15.0.0");
    // Pre-fix: unversioned fragments were dropped outright, stripping the
    // actual release content and leaving a bare version heading.
    expect(out).toContain("- new streaming API");
    expect(out).not.toContain("### v14.0.0");
    expect(out).not.toContain("- old fix");
  });

  it("returns raw unchanged when no version bounds are given", () => {
    const raw = "### v2.0.0\n- a\n";
    expect(filterReleasesByVersion(raw)).toBe(raw);
  });
});
