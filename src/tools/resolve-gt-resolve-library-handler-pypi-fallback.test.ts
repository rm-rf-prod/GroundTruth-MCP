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

    // CORR-005: multi-word query where tokens appear separately in description
    it("boosts score by 5 when multi-word query tokens appear separately in description", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      const asyncEntry = {
        ...registryEntry,
        id: "tokio/tokio",
        name: "tokio",
        description: "an async HTTP runtime for Node applications",
      };
      vi.mocked(fuzzySearch).mockReturnValue([asyncEntry]);
      // query = "async runtime" — tokens "async" + "runtime" appear separately in description
      const result = await handler({ libraryName: "tokio", query: "async runtime" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(85); // 80 + 5
    });

    it("does not boost score when no query token matches description", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([registryEntry]);
      // registryEntry description: "A JavaScript library for building user interfaces"
      // query tokens ("zzz", "xyz") do not appear in that description
      const result = await handler({ libraryName: "react", query: "zzz xyz" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(80); // no boost
    });
  });

});
