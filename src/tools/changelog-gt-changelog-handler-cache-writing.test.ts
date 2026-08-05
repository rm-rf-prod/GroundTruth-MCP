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

const RELEASES_CONTENT = "## Recent Releases\n\n### v15.2.0\nPublished: 2026-01-15\nBreaking changes.";

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

describe("gt_changelog handler", () => {
  describe("cache writing", () => {
    it("caches successful response", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchGitHubReleases).mockResolvedValue(RELEASES_CONTENT);
      await handler({ libraryId: "vercel/next.js" });
      expect(docCache.set).toHaveBeenCalled();
    });
  });
});
