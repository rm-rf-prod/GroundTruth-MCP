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
  describe("CORR-004: crates/go dedup guard", () => {
    it("does not push crates result when its id already exists in matches", async () => {
      // Setup: npm returns a result with id "crates:serde" — same id crates would return.
      // The crates path only fires when matches.length === 0 after npm/pypi, so we need
      // a scenario where fuzzy gives 1 low-score hit (score 80, length < 3) to pass the
      // external-fallback guard, then npm+pypi both null, so crates fires and tries to
      // push a match with the same id as the fuzzy entry.
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const fuzzyEntry = { ...registryEntry, id: "crates:serde", name: "serde" };
      vi.mocked(fuzzySearch).mockReturnValue([fuzzyEntry]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      // fetchWithTimeout: crates.io returns a result with same id "crates:serde"
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url.startsWith("https://crates.io/api/v1/crates/")) {
          return {
            ok: true,
            json: async () => ({
              crate: {
                name: "serde",
                description: "A serialization framework for Rust",
              },
            }),
          } as unknown as Response;
        }
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "serde" });
      const matches = result.structuredContent!.matches as Array<{ id: string }>;
      // No duplicate: only one entry with id "crates:serde"
      const ids = matches.map((m) => m.id);
      expect(ids.filter((id) => id === "crates:serde")).toHaveLength(1);
    });
  });

});
