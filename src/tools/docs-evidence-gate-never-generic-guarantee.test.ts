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

describe("evidence gate (never-generic guarantee)", () => {
  it("returns an honest miss when the topic never appears in any fetched source", async () => {
    vi.mocked(lookupById).mockReturnValue(makeEntry());
    vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
    const result = await handler({ libraryId: "facebook/react", topic: "webhooks retry policy" });
    expect(result.content[0]!.text).toContain("no topic-specific evidence found");
    expect(result.content[0]!.text).toContain("Sources checked:");
    const sc = result.structuredContent!;
    expect((sc.evidence as { verdict: string }).verdict).toBe("miss");
    expect(sc.qualityScore).toBe(0);
    expect(sc).toMatchObject({
      libraryId: "facebook/react",
      displayName: "React",
      topic: "webhooks retry policy",
      sourceUrl: "https://react.dev/llms.txt",
    });
  });

  it("escalates with a forced deep fetch when initial output lacks evidence, then serves the on-topic result", async () => {
    vi.mocked(lookupById).mockReturnValue(makeEntry());
    vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
    const onTopic = {
      content: "# Webhooks\n\nConfigure webhooks retry policy. Webhooks retry uses backoff. Webhooks signing keys.",
      url: "https://react.dev/docs/webhooks",
      sourceType: "deep-fetch" as const,
    };
    vi.mocked(deepFetchForTopic)
      .mockResolvedValueOnce(makeFetchResult())
      .mockResolvedValueOnce(onTopic);

    const result = await handler({ libraryId: "facebook/react", topic: "webhooks" });

    const calls = vi.mocked(deepFetchForTopic).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[1]![5]).toBe(true);
    expect(result.content[0]!.text).toContain("Configure webhooks retry policy");
    const sc = result.structuredContent!;
    expect((sc.evidence as { verdict: string; escalated: boolean }).verdict).toBe("strong");
    expect((sc.evidence as { escalated: boolean }).escalated).toBe(true);
  });

  it("appends an Evidence block with source attribution on success", async () => {
    vi.mocked(lookupById).mockReturnValue(makeEntry());
    vi.mocked(fetchDocs).mockResolvedValue(
      makeFetchResult("# Hooks\n\nHooks let you use state. Custom hooks compose hooks."),
    );
    const result = await handler({ libraryId: "facebook/react", topic: "hooks" });
    const text = result.content[0]!.text;
    expect(text).toContain("## Evidence");
    expect(text).toContain("Topic coverage:");
    expect(text).toContain("https://react.dev/llms.txt");
  });

  it("marks sparse coverage with a weak-evidence banner instead of pretending", async () => {
    vi.mocked(lookupById).mockReturnValue(makeEntry());
    // Present more than once but with no heading and no code: still served,
    // still flagged. One mention only is handled by the next test.
    const sparse = "The library also supports caching somewhere. Caching is configurable. "
      .concat("Unrelated prose. ".repeat(20));
    vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult(sparse));
    vi.mocked(deepFetchForTopic).mockImplementation(async (result) => result);
    const result = await handler({ libraryId: "facebook/react", topic: "caching" });
    expect(result.content[0]!.text).toContain("Evidence: Weak");
    const sc = result.structuredContent!;
    expect((sc.evidence as { verdict: string }).verdict).toBe("weak");
  });

});
