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

describe("gt_audit handler — category filtering", () => {
  it("limits patterns to specified category", async () => {
    // FILE_WITH_ISSUE triggers layout (100vh) — if we filter to "security" only, no match
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH, categories: ["security"] });
    expect(result.content[0]!.text).toContain("No issues found");
  });

  it("all category finds the layout issue", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH, categories: ["all"] });
    expect(result.structuredContent?.totalIssues).toBeGreaterThan(0);
  });

  it("layout category matches 100vh issue", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH, categories: ["layout"] });
    const issues = result.structuredContent?.issues ?? [];
    expect(issues.some((i) => i.category === "layout")).toBe(true);
  });
});

describe("gt_audit handler — groupIssues (same issue in multiple files)", () => {
  it("groups identical issue titles across files into one entry", async () => {
    await mockFiles([
      { name: "a.ts", content: LINE_WITH_ISSUE },
      { name: "b.ts", content: LINE_WITH_ISSUE },
    ]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    const issues = result.structuredContent?.issues ?? [];
    // Both files trigger "100vh" — should be grouped into one entry with count >= 2
    const grouped = issues.find((i) => i.count >= 2);
    expect(grouped).toBeDefined();
  });

  it("uniqueIssueTypes reflects distinct issue titles", async () => {
    await mockFiles([
      { name: "a.ts", content: LINE_WITH_ISSUE },
      { name: "b.ts", content: LINE_WITH_ISSUE },
    ]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    // All occurrences have the same title → 1 unique type (or more if multiple patterns match)
    expect(result.structuredContent?.uniqueIssueTypes).toBeGreaterThan(0);
    expect(result.structuredContent?.uniqueIssueTypes).toBeLessThanOrEqual(
      (result.structuredContent?.totalIssues ?? 0),
    );
  });
});
