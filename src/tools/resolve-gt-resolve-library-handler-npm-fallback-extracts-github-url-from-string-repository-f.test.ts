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
    it("extracts GitHub URL from string repository field", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(undefined);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "string-repo-pkg",
        description: "test",
        homepage: "https://example.com",
        repository: "git+https://github.com/org/string-repo-pkg.git",
      });
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      const result = await handler({ libraryName: "string-repo-pkg" });
      const match = (result.structuredContent as { matches: Array<{ githubUrl: string }> }).matches[0];
      expect(match!.githubUrl).toBe("https://github.com/org/string-repo-pkg");
    });

  });
});
