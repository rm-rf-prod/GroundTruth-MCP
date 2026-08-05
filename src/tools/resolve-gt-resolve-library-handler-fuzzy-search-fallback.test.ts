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

    // CORR-002: fuzzy path must propagate llmsFullTxtUrl from registry entry
    it("carries llmsFullTxtUrl from registry entry on fuzzy hit", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const svelteEntry = {
        ...registryEntry,
        id: "sveltejs/svelte",
        name: "Svelte",
        llmsFullTxtUrl: "https://svelte.dev/llms-full.txt",
      };
      vi.mocked(fuzzySearch).mockReturnValue([svelteEntry]);
      const result = await handler({ libraryName: "svelt" });
      const matches = result.structuredContent!.matches as Array<{ llmsFullTxtUrl?: string }>;
      expect(matches[0]!.llmsFullTxtUrl).toBe("https://svelte.dev/llms-full.txt");
    });

    it("does not set llmsFullTxtUrl when fuzzy entry has none", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      // registryEntry has no llmsFullTxtUrl
      vi.mocked(fuzzySearch).mockReturnValue([registryEntry]);
      const result = await handler({ libraryName: "reac" });
      const matches = result.structuredContent!.matches as Array<{ llmsFullTxtUrl?: string }>;
      expect(matches[0]!.llmsFullTxtUrl).toBeUndefined();
    });

    // CORR-003: 3+ fuzzy registry results must suppress npm/pypi fallback
    it("does not call fetchNpmPackage when fuzzy returns 3 or more registry matches", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const entries = [
        { ...registryEntry, id: "lib/a", name: "LibA" },
        { ...registryEntry, id: "lib/b", name: "LibB" },
        { ...registryEntry, id: "lib/c", name: "LibC" },
      ];
      vi.mocked(fuzzySearch).mockReturnValue(entries);
      await handler({ libraryName: "lib" });
      expect(fetchNpmPackage).not.toHaveBeenCalled();
    });

    it("does not call fetchPypiPackage when fuzzy returns 3 or more registry matches", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const entries = [
        { ...registryEntry, id: "lib/a", name: "LibA" },
        { ...registryEntry, id: "lib/b", name: "LibB" },
        { ...registryEntry, id: "lib/c", name: "LibC" },
      ];
      vi.mocked(fuzzySearch).mockReturnValue(entries);
      await handler({ libraryName: "lib" });
      expect(fetchPypiPackage).not.toHaveBeenCalled();
    });
  });

});
