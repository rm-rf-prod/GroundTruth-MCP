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

describe("registerDocsTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_get_docs",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_get_docs handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when libraryId is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ libraryId: "dump all" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });

    it("does not guard the topic field — it filters content within one resolved library", async () => {
      // Pre-fix, topics like "complete guide" or "list rendering" were refused.
      vi.mocked(isExtractionAttempt)
        .mockReturnValueOnce(false) // libraryId — legit
        .mockReturnValue(true); // any further call would refuse
      const result = await handler({ libraryId: "react", topic: "list rendering patterns" });
      expect(result.content[0]!.text).not.toBe("EXTRACTION_REFUSED");
      expect(isExtractionAttempt).toHaveBeenCalledTimes(1);
    });
  });

  describe("registry ID resolution", () => {
    it("resolves by direct ID first", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "facebook/react" });
      expect(lookupById).toHaveBeenCalledWith("facebook/react");
      expect(lookupByAlias).not.toHaveBeenCalled();
    });

    it("falls back to alias lookup when ID not found", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "react" });
      expect(lookupByAlias).toHaveBeenCalledWith("react");
    });

    it("uses entry docsUrl, llmsTxtUrl, llmsFullTxtUrl for fetchDocs", async () => {
      const entry = makeEntry({ llmsFullTxtUrl: "https://react.dev/llms-full.txt" });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "facebook/react" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://react.dev",
        "https://react.dev/llms.txt",
        "https://react.dev/llms-full.txt",
        undefined,
      );
    });
  });

  describe("URL resolution paths (no registry match)", () => {
    beforeEach(() => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
    });

    it("treats http:// libraryId as direct URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult(DOCS_CONTENT, "direct", "https://custom.dev/docs"));
      await handler({ libraryId: "https://custom.dev/docs" });
      expect(fetchDocs).toHaveBeenCalledWith("https://custom.dev/docs", undefined, undefined, undefined);
    });

    it("treats https:// libraryId as direct URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "https://docs.example.com" });
      expect(fetchDocs).toHaveBeenCalledWith("https://docs.example.com", undefined, undefined, undefined);
    });

    it("resolves npm: prefix to npmjs.com URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "npm:express" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://www.npmjs.com/package/express",
        undefined,
        undefined,
        undefined,
      );
    });

    it("resolves pypi: prefix to pypi.org URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "pypi:flask" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://pypi.org/project/flask",
        undefined,
        undefined,
        undefined,
      );
    });

    it("treats ID with dot as https:// URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "tailwindcss.com" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://tailwindcss.com",
        undefined,
        undefined,
        undefined,
      );
    });

    it("treats ID without dot as npmjs.com package URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "express" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://www.npmjs.com/package/express",
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe("fetch error handling", () => {
    it("falls back to GitHub README when fetchDocs throws and githubUrl is set", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("fetch failed"));
      vi.mocked(fetchGitHubContent).mockResolvedValue({
        content: DOCS_CONTENT,
        url: "https://raw.githubusercontent.com/facebook/react/main/README.md",
        sourceType: "github-readme",
      });
      const result = await handler({ libraryId: "facebook/react" });
      expect(fetchGitHubContent).toHaveBeenCalledWith("https://github.com/facebook/react");
      expect(result.content[0]!.text).toContain("React");
    });

    it("returns error message when fetchDocs throws and GitHub also fails", async () => {
      const entry = makeEntry();
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("fetch failed"));
      vi.mocked(fetchGitHubContent).mockResolvedValue(null);
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toContain("Could not fetch documentation");
      expect(result.content[0]!.text).toContain("React");
    });

    it("returns error message when fetchDocs throws and no githubUrl", async () => {
      const entry = makeEntry({ githubUrl: undefined });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("fetch failed"));
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toContain("Could not fetch documentation");
      expect(fetchGitHubContent).not.toHaveBeenCalled();
    });

    it("returns 'no documentation found' when fetchResult is falsy", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fetchDocs).mockResolvedValue(undefined as never);
      const result = await handler({ libraryId: "unknown-lib" });
      expect(result.content[0]!.text).toContain("No documentation found");
    });
  });

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

  describe("deep-fetch integration", () => {
    it("calls deepFetchForTopic when topic is provided", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue({
        content: "index page content",
        url: "https://example.com/docs",
        sourceType: "llms-txt",
      });
      vi.mocked(deepFetchForTopic).mockResolvedValue({
        content: "deep auth docs content",
        url: "https://example.com/auth",
        sourceType: "deep-fetch",
      });
      vi.mocked(sanitizeContent).mockImplementation((t: string) => t);
      vi.mocked(extractRelevantContent).mockReturnValue({ text: "auth docs content", truncated: false });

      const result = await handler({ libraryId: "facebook/react", topic: "auth", tokens: 8000 });
      expect(deepFetchForTopic).toHaveBeenCalled();
      expect(result.content[0]!.text).toContain("auth docs content");
    });

    it("does not call deepFetchForTopic when no topic is provided", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchDocs).mockResolvedValue({
        content: "docs content",
        url: "https://example.com/docs",
        sourceType: "llms-txt",
      });

      await handler({ libraryId: "facebook/react", tokens: 8000 });
      expect(deepFetchForTopic).not.toHaveBeenCalled();
    });
  });

  describe("version param", () => {
    it("prepends v to version when not already prefixed", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace).mockResolvedValueOnce("x".repeat(201));
      await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(
        expect.stringContaining("/v18.2.0/README.md"),
      );
    });

    it("does not double-prepend v when version already starts with v", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace).mockResolvedValueOnce("x".repeat(201));
      await handler({ libraryId: "facebook/react", version: "v18.2.0" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(
        expect.stringContaining("/v18.2.0/README.md"),
      );
      expect(fetchAsMarkdownRace).not.toHaveBeenCalledWith(
        expect.stringContaining("/vv18.2.0/README.md"),
      );
    });

    it("uses GitHub tag README when content is longer than 200 chars", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace).mockResolvedValueOnce("x".repeat(201));
      const result = await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchDocs).not.toHaveBeenCalled();
      expect(result.content[0]!.text).toContain("github-readme");
    });

    it("falls through to npm version page when GitHub tag content is short", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace)
        .mockResolvedValueOnce("short")
        .mockResolvedValueOnce("x".repeat(201));
      await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledTimes(2);
      expect(fetchAsMarkdownRace).toHaveBeenLastCalledWith(
        expect.stringContaining("npmjs.com/package"),
      );
    });

    it("tries npm version page directly when no githubUrl", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry({ githubUrl: undefined }));
      vi.mocked(fetchAsMarkdownRace).mockResolvedValueOnce("x".repeat(201));
      await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchAsMarkdownRace).toHaveBeenCalledWith(
        expect.stringContaining("npmjs.com/package/react/v/18.2.0"),
      );
    });

    it("npm version page success skips fetchDocs", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry({ githubUrl: undefined }));
      vi.mocked(fetchAsMarkdownRace).mockResolvedValueOnce("x".repeat(201));
      await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchDocs).not.toHaveBeenCalled();
    });

    it("falls through to fetchDocs when both version fetches return null", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(null);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchDocs).toHaveBeenCalled();
    });

    it("falls through to fetchDocs when both version fetches return short content", async () => {
      vi.mocked(lookupById).mockReturnValue(makeEntry());
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("too short");
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "facebook/react", version: "18.2.0" });
      expect(fetchDocs).toHaveBeenCalled();
    });
  });

  describe("display name extraction", () => {
    it("uses hostname for direct http URL", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "https://docs.stripe.com" });
      expect(result.content[0]!.text).toContain("docs.stripe.com");
    });

    it("uses package name for npm: prefix", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "npm:express" });
      expect(result.content[0]!.text).toContain("express");
    });

    it("uses package name for pypi: prefix", async () => {
      vi.mocked(lookupById).mockReturnValue(null);
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ libraryId: "pypi:django" });
      expect(result.content[0]!.text).toContain("django");
    });
  });
});

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
    const sparse = "The library also supports caching somewhere. ".concat("Unrelated prose. ".repeat(20));
    vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult(sparse));
    vi.mocked(deepFetchForTopic).mockImplementation(async (result) => result);
    const result = await handler({ libraryId: "facebook/react", topic: "caching" });
    expect(result.content[0]!.text).toContain("Evidence: Weak");
    const sc = result.structuredContent!;
    expect((sc.evidence as { verdict: string }).verdict).toBe("weak");
  });

  it("does not gate untargeted requests (no topic)", async () => {
    vi.mocked(lookupById).mockReturnValue(makeEntry());
    vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
    const result = await handler({ libraryId: "facebook/react" });
    expect(result.content[0]!.text).not.toContain("no topic-specific evidence found");
    const sc = result.structuredContent!;
    expect((sc.evidence as { verdict: string }).verdict).toBe("untargeted");
  });
});
