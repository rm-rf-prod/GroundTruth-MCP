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

    it("sets llmsTxtUrl when probe returns ok", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "llms-pkg",
        homepage: "https://llms-pkg.dev",
      });
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url === "https://llms-pkg.dev/llms.txt") return { ok: true } as Response;
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "llms-pkg" });
      const matches = result.structuredContent!.matches as Array<{ llmsTxtUrl?: string }>;
      expect(matches[0]!.llmsTxtUrl).toBe("https://llms-pkg.dev/llms.txt");
    });

    it("leaves llmsTxtUrl undefined when probe returns not ok", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "no-llms-pkg",
        homepage: "https://no-llms-pkg.dev",
      });
      const result = await handler({ libraryName: "no-llms-pkg" });
      const matches = result.structuredContent!.matches as Array<{ llmsTxtUrl?: string }>;
      expect(matches[0]!.llmsTxtUrl).toBeUndefined();
    });

    it("sets llmsFullTxtUrl when llms-full.txt probe returns ok", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "full-llms-pkg",
        homepage: "https://full-llms-pkg.dev",
      });
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url === "https://full-llms-pkg.dev/llms-full.txt") return { ok: true } as Response;
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "full-llms-pkg" });
      const matches = result.structuredContent!.matches as Array<{ llmsFullTxtUrl?: string }>;
      expect(matches[0]!.llmsFullTxtUrl).toBe("https://full-llms-pkg.dev/llms-full.txt");
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

  });
});
