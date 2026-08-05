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

    // CORR-002: exact alias path must propagate llmsFullTxtUrl from registry entry
    it("carries llmsFullTxtUrl from registry entry on exact alias hit", async () => {
      const svelteEntry = {
        ...registryEntry,
        id: "sveltejs/svelte",
        name: "Svelte",
        llmsFullTxtUrl: "https://svelte.dev/llms-full.txt",
      };
      vi.mocked(lookupByAlias).mockReturnValue(svelteEntry);
      const result = await handler({ libraryName: "svelte" });
      const matches = result.structuredContent!.matches as Array<{ llmsFullTxtUrl?: string }>;
      expect(matches[0]!.llmsFullTxtUrl).toBe("https://svelte.dev/llms-full.txt");
    });

    it("does not set llmsFullTxtUrl when registry entry has none (exact hit)", async () => {
      // registryEntry has no llmsFullTxtUrl
      vi.mocked(lookupByAlias).mockReturnValue(registryEntry);
      const result = await handler({ libraryName: "react" });
      const matches = result.structuredContent!.matches as Array<{ llmsFullTxtUrl?: string }>;
      expect(matches[0]!.llmsFullTxtUrl).toBeUndefined();
    });
  });

});
