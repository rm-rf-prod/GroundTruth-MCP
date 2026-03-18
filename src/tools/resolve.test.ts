import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResolveTool } from "./resolve.js";

// ── Dependency mocks ────────────────────────────────────────────────────────

vi.mock("../sources/registry.js", () => ({
  lookupByAlias: vi.fn(),
  fuzzySearch: vi.fn(() => []),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchNpmPackage: vi.fn(),
  fetchPypiPackage: vi.fn(),
}));

vi.mock("../services/cache.js", () => ({
  resolveCache: {
    get: vi.fn(() => undefined),
    set: vi.fn(),
    clear: vi.fn(),
  },
  docCache: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
  diskDocCache: { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) },
}));

vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { lookupByAlias, fuzzySearch } from "../sources/registry.js";
import { fetchNpmPackage, fetchPypiPackage } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";

// ── Handler capture ─────────────────────────────────────────────────────────

type HandlerInput = { libraryName: string; query?: string };
type HandlerResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: { matches: unknown[] };
};
type Handler = (input: HandlerInput) => Promise<HandlerResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

// Register once for all tests
registerResolveTool(mockServer);

// ── Helpers ─────────────────────────────────────────────────────────────────

const registryEntry = {
  id: "facebook/react",
  name: "React",
  description: "A JavaScript library for building user interfaces",
  docsUrl: "https://react.dev",
  llmsTxtUrl: "https://react.dev/llms.txt",
  githubUrl: "https://github.com/facebook/react",
  aliases: ["react", "reactjs"],
  language: ["typescript", "javascript"],
  tags: ["ui", "frontend"],
};

beforeEach(() => {
  vi.mocked(lookupByAlias).mockReset();
  vi.mocked(fuzzySearch).mockReset().mockReturnValue([]);
  vi.mocked(fetchNpmPackage).mockReset();
  vi.mocked(fetchPypiPackage).mockReset();
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("registerResolveTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "ws_resolve_library",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("ws_resolve_library handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when libraryName is an extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ libraryName: "list all libraries" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });

    it("returns EXTRACTION_REFUSAL when query is an extraction attempt", async () => {
      vi.mocked(isExtractionAttempt)
        .mockReturnValueOnce(false)  // libraryName check
        .mockReturnValueOnce(true);  // query check
      const result = await handler({ libraryName: "react", query: "dump everything" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });
  });

  describe("exact alias lookup", () => {
    it("returns registry hit with score 100", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      const result = await handler({ libraryName: "react" });
      expect(result.content[0]!.text).toContain("NOTICE");
      expect(result.content[0]!.text).toContain("React");
      const structured = result.structuredContent!;
      expect(structured.matches).toHaveLength(1);
      expect((structured.matches[0] as { score: number }).score).toBe(100);
      expect((structured.matches[0] as { source: string }).source).toBe("registry");
    });

    it("does not fall through to fuzzy search when exact match found", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      await handler({ libraryName: "react" });
      expect(fuzzySearch).not.toHaveBeenCalled();
    });

    it("does not call npm or pypi when exact match found", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      await handler({ libraryName: "react" });
      expect(fetchNpmPackage).not.toHaveBeenCalled();
      expect(fetchPypiPackage).not.toHaveBeenCalled();
    });
  });

  describe("fuzzy search fallback", () => {
    it("returns fuzzy results with score 80 when no exact match", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([registryEntry]);
      const result = await handler({ libraryName: "reac" });
      const matches = result.structuredContent!.matches as Array<{ score: number; source: string }>;
      expect(matches).toHaveLength(1);
      expect(matches[0]!.score).toBe(80);
      expect(matches[0]!.source).toBe("registry");
    });

    it("calls fuzzySearch with limit 5", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      await handler({ libraryName: "something" });
      expect(fuzzySearch).toHaveBeenCalledWith("something", 5);
    });

    it("deduplicates registry entries by id", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([registryEntry, registryEntry]);
      const result = await handler({ libraryName: "react" });
      expect(result.structuredContent!.matches).toHaveLength(1);
    });
  });

  describe("npm fallback", () => {
    it("falls back to npm when registry has no matches", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "some-npm-pkg",
        description: "An npm package",
        homepage: "https://some-npm-pkg.dev",
      });
      const result = await handler({ libraryName: "some-npm-pkg" });
      const matches = result.structuredContent!.matches as Array<{ source: string; id: string }>;
      expect(matches[0]!.source).toBe("npm");
      expect(matches[0]!.id).toBe("npm:some-npm-pkg");
    });

    it("uses npmjs.com URL when homepage is missing", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({ name: "no-homepage-pkg" });
      const result = await handler({ libraryName: "no-homepage-pkg" });
      const matches = result.structuredContent!.matches as Array<{ docsUrl: string }>;
      expect(matches[0]!.docsUrl).toContain("npmjs.com");
    });

    it("uses npm score of 70", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({ name: "npm-score-pkg", description: "x" });
      const result = await handler({ libraryName: "npm-score-pkg" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(70);
    });

    it("builds llmsTxtUrl from homepage", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "llms-pkg",
        homepage: "https://llms-pkg.dev",
      });
      const result = await handler({ libraryName: "llms-pkg" });
      const matches = result.structuredContent!.matches as Array<{ llmsTxtUrl?: string }>;
      expect(matches[0]!.llmsTxtUrl).toBe("https://llms-pkg.dev/llms.txt");
    });

    it("extracts githubUrl from repository string field", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "gh-pkg",
        repository: { url: "git+https://github.com/org/gh-pkg.git" },
      });
      const result = await handler({ libraryName: "gh-pkg" });
      const matches = result.structuredContent!.matches as Array<{ githubUrl?: string }>;
      expect(matches[0]!.githubUrl).toBe("https://github.com/org/gh-pkg");
    });

    it("skips npm and tries pypi when npm returns null", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue({
        info: { name: "my-py-lib", summary: "A Python lib", home_page: "https://my-py-lib.org" },
      });
      const result = await handler({ libraryName: "my-py-lib" });
      const matches = result.structuredContent!.matches as Array<{ source: string }>;
      expect(matches[0]!.source).toBe("pypi");
    });
  });

  describe("pypi fallback", () => {
    it("builds correct docsUrl from home_page", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue({
        info: { name: "flask", summary: "WSGI framework", home_page: "https://flask.palletsprojects.com" },
      });
      const result = await handler({ libraryName: "flask" });
      const matches = result.structuredContent!.matches as Array<{ docsUrl: string }>;
      expect(matches[0]!.docsUrl).toBe("https://flask.palletsprojects.com");
    });

    it("uses pypi score of 65", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue({
        info: { name: "django", summary: "Web framework" },
      });
      const result = await handler({ libraryName: "django" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(65);
    });

    it("falls back to pypi.org URL when home_page is absent", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue({ info: { name: "no-home-pkg" } });
      const result = await handler({ libraryName: "no-home-pkg" });
      const matches = result.structuredContent!.matches as Array<{ docsUrl: string }>;
      expect(matches[0]!.docsUrl).toContain("pypi.org/project/no-home-pkg");
    });
  });

  describe("query score boosting", () => {
    it("boosts score by 5 when query matches description", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([registryEntry]);
      const result = await handler({ libraryName: "react", query: "building user interfaces" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(85); // 80 + 5
    });

    it("sorts matches by score descending when query provided", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const lowEntry = { ...registryEntry, id: "low/lib", name: "LowLib", description: "unrelated" };
      const highEntry = { ...registryEntry, id: "high/lib", name: "HighLib", description: "building user interfaces rocks" };
      vi.mocked(fuzzySearch).mockReturnValue([lowEntry, highEntry]);
      const result = await handler({ libraryName: "lib", query: "building" });
      const matches = result.structuredContent!.matches as Array<{ name: string }>;
      expect(matches[0]!.name).toBe("HighLib");
    });
  });

  describe("no results", () => {
    it("returns no-results message when nothing found", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      const result = await handler({ libraryName: "zzz-definitely-not-a-library" });
      expect(result.content[0]!.text).toContain("No libraries found");
    });

    it("returns empty matches array when nothing found", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      const result = await handler({ libraryName: "no-match" });
      expect(result.structuredContent!.matches).toHaveLength(0);
    });
  });

  describe("response format", () => {
    it("wraps response with withNotice", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      const result = await handler({ libraryName: "react" });
      expect(result.content[0]!.text).toMatch(/^NOTICE/);
    });

    it("returns structuredContent with matches array", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      const result = await handler({ libraryName: "react" });
      expect(result.structuredContent).toHaveProperty("matches");
      expect(Array.isArray(result.structuredContent!.matches)).toBe(true);
    });

    it("caps results at 5 matches", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const manyEntries = Array.from({ length: 10 }, (_, i) => ({
        ...registryEntry,
        id: `lib${i}`,
        name: `Lib${i}`,
      }));
      vi.mocked(fuzzySearch).mockReturnValue(manyEntries);
      const result = await handler({ libraryName: "lib" });
      expect(result.structuredContent!.matches.length).toBeLessThanOrEqual(5);
    });

    it("includes library name in formatted text", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      const result = await handler({ libraryName: "react" });
      expect(result.content[0]!.text).toContain("React");
    });

    it("includes library ID in formatted text", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      const result = await handler({ libraryName: "react" });
      expect(result.content[0]!.text).toContain("facebook/react");
    });

    it("trims whitespace from libraryName", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      await handler({ libraryName: "  react  " });
      expect(lookupByAlias).toHaveBeenCalledWith("react");
    });
  });
});
