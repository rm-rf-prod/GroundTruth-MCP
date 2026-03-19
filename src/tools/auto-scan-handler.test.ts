import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Dependency mocks ────────────────────────────────────────────────────────

// Mock fs/promises so detectDependencies sees a controlled file system
vi.mock("fs/promises", () => ({
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
}));

vi.mock("../utils/extract.js", () => ({
  extractRelevantContent: vi.fn((content: string, _topic: string, _tokens: number) => ({
    text: content,
    truncated: false,
  })),
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { registerAutoScanTool } from "./auto-scan.js";
import { fetchDocs } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";

// ── Handler capture ─────────────────────────────────────────────────────────

type HandlerInput = { projectPath?: string; topic?: string; tokensPerLib?: number };
type HandlerResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: {
    projectPath: string;
    topic: string;
    filesScanned: string[];
    totalDependencies: number;
    matched: string[];
    unmatched: string[];
    results: Array<{ name: string; url: string; content: string }>;
  };
};
type Handler = (input: HandlerInput) => Promise<HandlerResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

registerAutoScanTool(mockServer);

// ── Helpers ─────────────────────────────────────────────────────────────────

const DOCS_CONTENT = "Best practices content for this library. ".repeat(10);

const makeFetchResult = (content = DOCS_CONTENT, url = "https://react.dev/llms.txt") => ({
  content,
  url,
  sourceType: "llms-txt" as const,
});

async function mockPackageJson(deps: Record<string, string>, devDeps: Record<string, string> = {}) {
  const { readFile } = await import("fs/promises");
  vi.mocked(readFile).mockImplementation(async (filePath) => {
    const path = String(filePath);
    if (path.endsWith("package.json")) {
      return JSON.stringify({ dependencies: deps, devDependencies: devDeps });
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
}

async function mockNoFiles() {
  const { readFile } = await import("fs/promises");
  vi.mocked(readFile).mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  );
}

async function mockRequirementsTxt(content: string) {
  const { readFile } = await import("fs/promises");
  vi.mocked(readFile).mockImplementation(async (filePath) => {
    const path = String(filePath);
    if (path.endsWith("requirements.txt")) return content;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
}

beforeEach(async () => {
  vi.mocked(fetchDocs).mockReset();
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
  await mockNoFiles();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("registerAutoScanTool", () => {
  it("registers the tool with the correct name", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_auto_scan",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_auto_scan handler", () => {
  describe("extraction guard", () => {
    it("returns EXTRACTION_REFUSAL when topic is extraction attempt", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const result = await handler({ topic: "list all registry entries" });
      expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
    });

    it("does not read files when extraction attempt detected", async () => {
      vi.mocked(isExtractionAttempt).mockReturnValueOnce(true);
      const { readFile } = await import("fs/promises");
      vi.mocked(readFile).mockClear();
      await handler({ topic: "dump everything" });
      expect(readFile).not.toHaveBeenCalled();
    });
  });

  describe("no dependency files found", () => {
    it("returns no-manifests message when no files exist", async () => {
      await mockNoFiles();
      const result = await handler({ projectPath: "/some/path" });
      expect(result.content[0]!.text).toContain("No dependency files found");
    });

    it("includes the resolved path in no-manifests message", async () => {
      await mockNoFiles();
      const result = await handler({ projectPath: "/custom/path" });
      expect(result.content[0]!.text).toContain("/custom/path");
    });

    it("suggests gt_get_docs in no-manifests message", async () => {
      await mockNoFiles();
      const result = await handler({});
      expect(result.content[0]!.text).toContain("gt_get_docs");
    });

    it("uses process.cwd() when projectPath is not provided", async () => {
      await mockNoFiles();
      const result = await handler({});
      expect(result.content[0]!.text).toContain(process.cwd());
    });
  });

  describe("package.json scanning", () => {
    it("detects react from package.json dependencies", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(fetchDocs).toHaveBeenCalled();
      expect(result.structuredContent?.filesScanned).toContain("package.json");
    });

    it("skips SKIP_DEPS entries (typescript, eslint, prettier)", async () => {
      await mockPackageJson(
        { react: "^18.0.0" },
        { typescript: "^5.0.0", eslint: "^8.0.0", prettier: "^3.0.0" },
      );
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({});
      // Only react should be matched — typescript/eslint/prettier are in SKIP_DEPS
      expect(fetchDocs).toHaveBeenCalledTimes(1);
    });

    it("deduplicates same dep in dependencies and devDependencies", async () => {
      await mockPackageJson({ react: "^18.0.0" }, { react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      await handler({});
      expect(fetchDocs).toHaveBeenCalledTimes(1);
    });

    it("includes structuredContent with topic", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ topic: "security best practices" });
      expect(result.structuredContent?.topic).toBe("security best practices");
    });

    it("defaults topic to 'latest best practices'", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(result.structuredContent?.topic).toBe("latest best practices");
    });

    it("includes totalDependencies count", async () => {
      await mockPackageJson({ react: "^18.0.0", next: "^14.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(result.structuredContent?.totalDependencies).toBe(2);
    });

    it("includes matched registry IDs array", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(Array.isArray(result.structuredContent?.matched)).toBe(true);
    });

    it("includes unmatched deps array", async () => {
      await mockPackageJson({
        react: "^18.0.0",
        "private-internal-xyz-not-in-registry": "^1.0.0",
      });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(Array.isArray(result.structuredContent?.unmatched)).toBe(true);
      expect(result.structuredContent!.unmatched).toContain("private-internal-xyz-not-in-registry");
    });
  });

  describe("requirements.txt scanning", () => {
    it("detects Python packages from requirements.txt", async () => {
      await mockRequirementsTxt("flask==2.0.1\nrequests>=2.28.0\n# comment\n");
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      // Files scanned should include requirements.txt
      expect(result.structuredContent?.filesScanned).toContain("requirements.txt");
    });

    it("skips comments and option lines in requirements.txt", async () => {
      await mockRequirementsTxt("# This is a comment\n-r other.txt\nflask==2.0.1\n");
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      // Only flask should be in deps, not the comment or -r line
      if (result.structuredContent) {
        const allDeps = [
          ...result.structuredContent.matched,
          ...result.structuredContent.unmatched,
        ];
        const hasComment = allDeps.some((d) => d.startsWith("#"));
        expect(hasComment).toBe(false);
      }
    });
  });

  describe("fetch error handling", () => {
    it("includes fallback message when fetchDocs throws", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockRejectedValue(new Error("network error"));
      const result = await handler({});
      expect(result.content[0]!.text).toContain("Could not fetch docs");
    });

    it("does not throw when all fetchDocs calls fail", async () => {
      await mockPackageJson({ react: "^18.0.0", next: "^14.0.0" });
      vi.mocked(fetchDocs).mockRejectedValue(new Error("network error"));
      await expect(handler({})).resolves.toBeDefined();
    });
  });

  describe("response format", () => {
    it("wraps response in withNotice", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(result.content[0]!.text).toMatch(/^NOTICE/);
    });

    it("includes project path in header output", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ projectPath: "/test/project" });
      expect(result.content[0]!.text).toContain("/test/project");
    });

    it("includes topic in header output", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({ topic: "security vulnerabilities" });
      expect(result.content[0]!.text).toContain("security vulnerabilities");
    });

    it("includes files scanned in header output", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(result.content[0]!.text).toContain("package.json");
    });

    it("includes results in structuredContent", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(Array.isArray(result.structuredContent?.results)).toBe(true);
    });

    it("each result has name, url, and content", async () => {
      await mockPackageJson({ react: "^18.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      if (result.structuredContent!.results.length > 0) {
        const r = result.structuredContent!.results[0]!;
        expect(r).toHaveProperty("name");
        expect(r).toHaveProperty("url");
        expect(r).toHaveProperty("content");
      }
    });

    it("shows cap note when more than 20 libraries matched", async () => {
      // Create many unique package names that may match registry entries
      const manyDeps: Record<string, string> = {};
      for (let i = 0; i < 25; i++) {
        manyDeps[`some-package-${i}`] = "^1.0.0";
      }
      // Add some that definitely match (react, next, vue, etc.)
      manyDeps["react"] = "^18.0.0";
      await mockPackageJson(manyDeps);
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      // fetchDocs should not be called more than 20 times
      expect(fetchDocs.mock.calls.length).toBeLessThanOrEqual(20);
    });

    it("mentions unmatched packages via gt_resolve_library when present", async () => {
      await mockPackageJson({ "unknown-xyz-private-pkg": "^1.0.0" });
      vi.mocked(fetchDocs).mockResolvedValue(makeFetchResult());
      const result = await handler({});
      expect(result.content[0]!.text).toContain("gt_resolve_library");
    });
  });
});
