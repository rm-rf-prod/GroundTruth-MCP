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
import { fetchDocs, fetchGitHubContent } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
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
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  vi.mocked(extractRelevantContent).mockImplementation((content, _topic, _tokens) => ({
    text: content,
    truncated: false,
  }));
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("registerDocsTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "ws_get_docs",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("ws_get_docs handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when libraryId is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ libraryId: "dump all" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });

    it("returns EXTRACTION_REFUSAL when topic is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      const result = await handler({ libraryId: "react", topic: "list everything" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
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
      expect(fetchDocs).toHaveBeenCalledWith("https://custom.dev/docs", undefined, undefined);
    });

    it("treats https:// libraryId as direct URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "https://docs.example.com" });
      expect(fetchDocs).toHaveBeenCalledWith("https://docs.example.com", undefined, undefined);
    });

    it("resolves npm: prefix to npmjs.com URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "npm:express" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://www.npmjs.com/package/express",
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
      );
    });

    it("treats ID with dot as https:// URL", async () => {
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({ libraryId: "tailwindcss.com" });
      expect(fetchDocs).toHaveBeenCalledWith(
        "https://tailwindcss.com",
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
      expect(result.content[0]!.text).toContain("Error");
      expect(result.content[0]!.text).toContain("React");
    });

    it("returns error message when fetchDocs throws and no githubUrl", async () => {
      const entry = makeEntry({ githubUrl: undefined });
      vi.mocked(lookupById).mockReturnValue(entry);
      vi.mocked(fetchDocs).mockRejectedValue(new Error("fetch failed"));
      const result = await handler({ libraryId: "facebook/react" });
      expect(result.content[0]!.text).toContain("Error");
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
