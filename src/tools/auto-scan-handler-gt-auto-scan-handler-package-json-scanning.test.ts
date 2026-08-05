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

vi.mock("../utils/lockfile.js", () => ({
  detectAllVersions: vi.fn(async () => new Map<string, string>()),
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
  withToolTimeout: vi.fn(async (fn: () => Promise<unknown>, _fallback: unknown) => fn()),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
  safeguardPath: vi.fn((p: string) => p),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { registerAutoScanTool } from "./auto-scan.js";
import { fetchDocs } from "../services/fetcher.js";
import { isExtractionAttempt } from "../utils/guard.js";
import { detectAllVersions } from "../utils/lockfile.js";

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
  vi.mocked(detectAllVersions).mockReset().mockResolvedValue(new Map<string, string>());
  await mockNoFiles();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("gt_auto_scan handler", () => {
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
        { typescript: "^5.2.0", eslint: "^8.0.0", prettier: "^3.0.3" },
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
      await mockPackageJson({ react: "^18.0.0", next: "^15.2.0" });
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

});
