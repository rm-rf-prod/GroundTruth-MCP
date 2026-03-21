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
  fetchViaJina: vi.fn(async () => null),
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
import { fetchNpmPackage, fetchPypiPackage, fetchWithTimeout, fetchViaJina } from "../services/fetcher.js";
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
  vi.mocked(fetchViaJina).mockReset().mockResolvedValue(null);
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("registerResolveTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_resolve_library",
      expect.anything(),
      expect.any(Function),
    );
  });
});

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

    it("handles network errors during llms.txt probing gracefully", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(undefined);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue({
        name: "error-probe-pkg",
        description: "test",
        homepage: "https://example.com",
      });
      vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("network error"));
      const result = await handler({ libraryName: "error-probe-pkg" });
      expect(result.content[0]!.text).toContain("error-probe-pkg");
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
      vi.mocked(fetchViaJina).mockResolvedValue("A Go module for doing things with bytes");
      const result = await handler({ libraryName: "golang.org/x/text" });
      const matches = result.structuredContent!.matches as Array<{ source: string }>;
      expect(matches[0]!.source).toBe("go");
    });
  });

  describe("Go pkg.go.dev fallback", () => {
    it("falls back to pkg.go.dev when all others return null", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchViaJina).mockResolvedValue(
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
      vi.mocked(fetchViaJina).mockResolvedValue("A fast HTTP router for Go applications");
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
      vi.mocked(fetchViaJina).mockResolvedValue("Standard library utilities");
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
      vi.mocked(fetchViaJina).mockResolvedValue("Concurrency primitives for Go");
      const result = await handler({ libraryName: "golang.org/x/sync" });
      const matches = result.structuredContent!.matches as Array<{ score: number }>;
      expect(matches[0]!.score).toBe(55);
    });

    it("returns no results when fetchViaJina returns null", async () => {
      vi.mocked(lookupByAlias).mockReturnValue(null);
      vi.mocked(fuzzySearch).mockReturnValue([]);
      vi.mocked(fetchNpmPackage).mockResolvedValue(null);
      vi.mocked(fetchPypiPackage).mockResolvedValue(null);
      vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false } as Response);
      vi.mocked(fetchViaJina).mockResolvedValue(null);
      const result = await handler({ libraryName: "zzz-unknown-go-module" });
      expect(result.structuredContent!.matches).toHaveLength(0);
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
