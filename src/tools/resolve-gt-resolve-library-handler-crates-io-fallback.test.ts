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
  describe("crates.io fallback", () => {
    it("falls back to crates.io when npm and pypi return null", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url.startsWith("https://crates.io/api/v1/crates/")) {
          return {
            ok: true,
            json: async () => ({
              crate: {
                name: "serde",
                description: "A serialization framework",
                documentation: "https://docs.rs/serde",
                repository: "https://github.com/serde-rs/serde",
              },
            }),
          } as unknown as Response;
        }
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "serde" });
      const matches = result.structuredContent!.matches as Array<{ source: string; id: string }>;
      expect(matches[0]!.source).toBe("crates");
      expect(matches[0]!.id).toBe("crates:serde");
    });

    it("uses crates.io URL as docsUrl when documentation field is missing", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url.startsWith("https://crates.io/api/v1/crates/")) {
          return {
            ok: true,
            json: async () => ({
              crate: { name: "tokio", description: "Async runtime" },
            }),
          } as unknown as Response;
        }
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "tokio" });
      const matches = result.structuredContent!.matches as Array<{ docsUrl: string }>;
      expect(matches[0]!.docsUrl).toContain("crates.io/crates/tokio");
    });

    it("extracts githubUrl from repository field when it contains github.com", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url.startsWith("https://crates.io/api/v1/crates/")) {
          return {
            ok: true,
            json: async () => ({
              crate: {
                name: "reqwest",
                description: "HTTP client",
                repository: "https://github.com/seanmonstar/reqwest",
              },
            }),
          } as unknown as Response;
        }
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "reqwest" });
      const matches = result.structuredContent!.matches as Array<{ githubUrl?: string }>;
      expect(matches[0]!.githubUrl).toBe("https://github.com/seanmonstar/reqwest");
    });

    it("uses score of 60 for crates results", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockImplementation(async (url: string) => {
        if (url.startsWith("https://crates.io/api/v1/crates/")) {
          return {
            ok: true,
            json: async () => ({ crate: { name: "rayon", description: "Parallelism" } }),
          } as unknown as Response;
        }
        return { ok: false } as Response;
      });
      const result = await handler({ libraryName: "rayon" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(60);
    });

    it("returns null and skips to Go when crates.io returns not ok", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("A Go module for doing things with bytes");
      const result = await handler({ libraryName: "golang.org/x/text" });
      const matches = result.structuredContent!.matches as Array<{ source: string }>;
      expect(matches[0]!.source).toBe("go");
    });
  });

});
