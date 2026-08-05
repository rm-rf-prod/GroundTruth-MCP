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

describe("raceUrls topic-first ranking", () => {
  it("puts the on-topic page first even when an off-topic page has higher quality", async () => {
    const MOCKING_PAGE = [
      "# Mocking",
      "",
      "Use vi.mock to mock modules. Mocking timers with vi.useFakeTimers.",
      "Mocking dates, mocking globals, and mocking network requests are covered below.",
      "Automocking follows the module registry; spies via vi.spyOn preserve the original implementation.",
      "",
      "```ts",
      "vi.mock('./module');",
      "```",
    ].join("\n");
    // Higher quality (more headings, more code, longer) but zero topic tokens.
    const SNAPSHOT_PAGE = Array.from({ length: 12 }, (_, i) =>
      `## Snapshot section ${i}\n\nSerialize values for snapshot testing.\n\n\`\`\`ts\nexpect(x).toMatchSnapshot();\n\`\`\``,
    ).join("\n\n") + "\n" + "padding ".repeat(500);

    vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
      if (url.includes("mocking")) return MOCKING_PAGE;
      if (url.includes("snapshot")) return SNAPSHOT_PAGE;
      return null;
    });

    const hit = await raceUrls(
      ["https://vitest.dev/guide/snapshot", "https://vitest.dev/guide/mocking"],
      "mocking",
    );
    expect(hit).not.toBeNull();
    expect(hit!.url).toBe("https://vitest.dev/guide/mocking");
    expect(hit!.extraUrls).toContain("https://vitest.dev/guide/snapshot");
  });

  it("falls back to quality ranking when no topic is given", async () => {
    vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) => {
      if (url.includes("rich")) return "# A\n\n\`\`\`ts\ncode();\n\`\`\`\n\n## B\n\n" + "text ".repeat(300);
      if (url.includes("thin")) return "just some plain text without structure that is long enough to pass the threshold ".repeat(4);
      return null;
    });
    const hit = await raceUrls(["https://x.dev/thin", "https://x.dev/rich"]);
    expect(hit!.url).toBe("https://x.dev/rich");
  });
});
