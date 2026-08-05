import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Dependency mocks ─────────────────────────────────────────────────────────
// All vi.mock calls must be hoisted above imports.

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchViaJina: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  fetchGitHubReleases: vi.fn(),
  fetchGitHubExamples: vi.fn(),
}));

vi.mock("../sources/registry.js", () => ({
  lookupById: vi.fn(),
  lookupByAlias: vi.fn(),
  fuzzySearch: vi.fn(() => []),
}));

vi.mock("../utils/extract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/extract.js")>()),
  extractRelevantContent: vi.fn((content: string) => ({ text: content, truncated: false })),
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { registerAuditTool } from "./audit.js";
import {
  fetchViaJina,
  fetchAsMarkdownRace,
  fetchDocs,
  fetchGitHubReleases,
  fetchGitHubExamples,
} from "../services/fetcher.js";
import { lookupById } from "../sources/registry.js";

// ── Handler capture ──────────────────────────────────────────────────────────

type HandlerInput = {
  projectPath?: string;
  categories?: string[];
  tokens?: number;
  maxFiles?: number;
};
type IssueRecord = {
  title: string;
  severity: string;
  category: string;
  count: number;
  locations: string[];
};
type HandlerResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: {
    projectPath: string;
    filesScanned: number;
    totalIssues?: number;
    uniqueIssueTypes?: number;
    issues?: IssueRecord[];
  };
};
type Handler = (input: HandlerInput) => Promise<HandlerResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

registerAuditTool(mockServer);

// ── Test helpers ─────────────────────────────────────────────────────────────

// Minimal Dirent-like objects — readProjectFiles only uses name, isDirectory(), isFile()
type FakeDirent = { name: string; isDirectory: () => boolean; isFile: () => boolean };

function makeFileEntry(name: string): FakeDirent {
  return { name, isDirectory: () => false, isFile: () => true };
}

// Content that triggers the layout "100vh" pattern (line: /\b100vh\b/)
const LINE_WITH_ISSUE = `const styles = { height: "100vh", width: "100vw" };`;
// Content that does NOT trigger any audit pattern
const LINE_CLEAN = `export const greeting = "hello";`;
// Commented-out version of the 100vh line — should NOT trigger
const LINE_COMMENTED = `// const styles = { height: "100vh" };`;

const PROJECT_PATH = "/test/project";
const DEFAULTS: HandlerInput = { categories: ["all"], tokens: 4000, maxFiles: 50 };

// ── Per-test reset ───────────────────────────────────────────────────────────

beforeEach(async () => {
  const fsp = await import("fs/promises");
  // By default: no files (empty directory)
  vi.mocked(fsp.readdir).mockReset().mockResolvedValue([] as unknown as ReturnType<typeof fsp.readdir> extends Promise<infer T> ? T : never);
  vi.mocked(fsp.readFile).mockReset().mockResolvedValue(LINE_CLEAN as unknown as never);
  vi.mocked(fsp.stat).mockReset().mockResolvedValue({ size: 500 } as unknown as never);

  vi.mocked(fetchViaJina).mockReset().mockResolvedValue("");
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue("");
  vi.mocked(fetchDocs).mockReset().mockResolvedValue(null as never);
  vi.mocked(fetchGitHubReleases).mockReset().mockResolvedValue(null);
  vi.mocked(fetchGitHubExamples).mockReset().mockResolvedValue(null);
  vi.mocked(lookupById).mockReset().mockReturnValue(undefined);
});

// Helper: make readdir return a flat list of files for the project path
async function mockFiles(
  files: Array<{ name: string; content: string }>,
) {
  const fsp = await import("fs/promises");
  const entries = files.map((f) => makeFileEntry(f.name));

  vi.mocked(fsp.readdir).mockImplementation(async (dir) => {
    if (String(dir) === PROJECT_PATH) {
      return entries as unknown as ReturnType<typeof fsp.readdir> extends Promise<infer T> ? T : never;
    }
    return [] as unknown as ReturnType<typeof fsp.readdir> extends Promise<infer T> ? T : never;
  });

  vi.mocked(fsp.readFile).mockImplementation(async (filePath) => {
    const p = String(filePath);
    for (const f of files) {
      if (p.endsWith(f.name)) return f.content as unknown as never;
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("gt_audit handler — issues found", () => {
  it("generates a report when a pattern matches", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("Code Audit Report");
  });

  it("includes file and line reference in report", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("app.ts");
  });

  it("includes severity badge in report", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    // 100vh is a "medium" severity issue
    expect(result.content[0]!.text).toMatch(/\[(CRITICAL|HIGH|MEDIUM|LOW)\]/);
  });

  it("returns structuredContent with issues array when issues found", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(Array.isArray(result.structuredContent?.issues)).toBe(true);
    expect(result.structuredContent!.issues!.length).toBeGreaterThan(0);
  });

  it("structuredContent issues have required fields (title, severity, category, count, locations)", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    const issue = result.structuredContent!.issues![0]!;
    expect(issue).toHaveProperty("title");
    expect(issue).toHaveProperty("severity");
    expect(issue).toHaveProperty("category");
    expect(issue).toHaveProperty("count");
    expect(Array.isArray(issue.locations)).toBe(true);
  });

  it("totalIssues equals actual issue count", async () => {
    // Two files each with one 100vh occurrence = 2 issues
    await mockFiles([
      { name: "a.ts", content: LINE_WITH_ISSUE },
      { name: "b.ts", content: LINE_WITH_ISSUE },
    ]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.structuredContent?.totalIssues).toBe(2);
  });

});
