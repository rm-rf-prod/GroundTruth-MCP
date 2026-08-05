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
  describe("Go pkg.go.dev fallback", () => {
    it("falls back to pkg.go.dev when all others return null", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(
        "Package gin implements a HTTP web framework\n\nMore content here",
      );
      const result = await handler({ libraryName: "github.com/gin-gonic/gin" });
      const matches = result.structuredContent!.matches as Array<{ source: string; id: string }>;
      expect(matches[0]!.source).toBe("go");
      expect(matches[0]!.id).toBe("go:github.com/gin-gonic/gin");
    });

    it("builds githubUrl for github.com module paths", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("A fast HTTP router for Go applications");
      const result = await handler({ libraryName: "github.com/julienschmidt/httprouter" });
      const matches = result.structuredContent!.matches as Array<{ githubUrl?: string }>;
      expect(matches[0]!.githubUrl).toBe("https://github.com/julienschmidt/httprouter");
    });

    it("sets docsUrl to pkg.go.dev URL", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("Standard library utilities");
      const result = await handler({ libraryName: "golang.org/x/sync" });
      const matches = result.structuredContent!.matches as Array<{ docsUrl: string }>;
      expect(matches[0]!.docsUrl).toBe("https://pkg.go.dev/golang.org/x/sync");
    });

    it("uses score of 55 for Go results", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue("Concurrency primitives for Go");
      const result = await handler({ libraryName: "golang.org/x/sync" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(55);
    });

    it("returns no results when fetchAsMarkdownRace returns null", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(null);
      const result = await handler({ libraryName: "zzz-unknown-go-module" });
      expect(result.structuredContent!.matches).toHaveLength(0);
    });

    // Bug C-2 — pkg.go.dev returns HTTP 200 with body "Title: 404 Not Found - Go Packages"
    // for unknown modules. Without detection, gt_resolve_library surfaced a fake
    // "go:zzzz-foo" match with garbage description.
    it("Bug C-2: rejects pkg.go.dev 404 page body so unknown module returns no result", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      // Simulate pkg.go.dev "200 OK" with 404 body — observed live response shape.
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(
        "Title: 404 Not Found - Go Packages\n\nURL Source: https://pkg.go.dev/zzzz-does-not-exist-xyz\n\nMarkdown Content:\n# 404 Not Found",
      );
      const result = await handler({ libraryName: "zzzz-does-not-exist-xyz" });
      const matches = result.structuredContent!.matches as Array<{ source: string }>;
      expect(matches).toHaveLength(0);
    });

    it("Bug C-2: still accepts a real Go module page", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchAsMarkdownRace).mockResolvedValue(
        "Package gin implements a HTTP web framework for Go applications",
      );
      const result = await handler({ libraryName: "github.com/gin-gonic/gin" });
      const matches = result.structuredContent!.matches as Array<{ source: string }>;
      expect(matches[0]!.source).toBe("go");
    });
  });

});
