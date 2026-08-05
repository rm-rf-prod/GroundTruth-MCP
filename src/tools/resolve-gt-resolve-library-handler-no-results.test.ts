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
  fetchWithTimeout: vi.fn(async () => ({ ok: false } as Response)),
  fetchAsMarkdownRace: vi.fn(async () => null),
}));

vi.mock("../services/cache.js", () => ({
  resolveCache: {
    get: vi.fn(() => undefined),
    set: vi.fn(),
    clear: vi.fn(),
  },
  llmsProbeCache: {
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
  assertPublicUrl: vi.fn(),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { lookupByAlias, fuzzySearch } from "../sources/registry.js";
import { fetchNpmPackage, fetchPypiPackage, fetchWithTimeout, fetchAsMarkdownRace } from "../services/fetcher.js";
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
  vi.mocked(fetchWithTimeout).mockReset().mockResolvedValue({ ok: false } as Response);
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(null);
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("gt_resolve_library handler", () => {
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
