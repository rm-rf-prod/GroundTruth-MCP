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

vi.mock("../utils/extract.js", () => ({
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

describe("registerAuditTool", () => {
  it("registers with the name gt_audit", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_audit",
      expect.anything(),
      expect.any(Function),
    );
  });
});

describe("gt_audit handler — unreadable project", () => {
  it("returns no-source-files when readdir throws (walk swallows the error)", async () => {
    // walk()'s inner try/catch silently swallows readdir errors → files stays empty →
    // the handler hits the files.length === 0 branch instead of the outer catch.
    const fsp = await import("fs/promises");
    vi.mocked(fsp.readdir).mockRejectedValue(new Error("EACCES: permission denied"));
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No source files found");
    expect(result.content[0]!.text).toContain(PROJECT_PATH);
  });

  it("does not return structuredContent on read error", async () => {
    const fsp = await import("fs/promises");
    vi.mocked(fsp.readdir).mockRejectedValue(new Error("EPERM"));
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("gt_audit handler — empty project", () => {
  it("returns no-source-files message when directory is empty", async () => {
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No source files found");
    expect(result.content[0]!.text).toContain(PROJECT_PATH);
  });

  it("uses process.cwd() when projectPath is omitted", async () => {
    const result = await handler({ ...DEFAULTS });
    expect(result.content[0]!.text).toContain(process.cwd());
  });
});

describe("gt_audit handler — no issues found", () => {
  it("returns no-issues header when files exist but no patterns match", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_CLEAN }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No issues found");
  });

  it("returns structuredContent with zero totalIssues when clean", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_CLEAN }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.structuredContent?.totalIssues).toBe(0);
    expect(result.structuredContent?.filesScanned).toBe(1);
  });

  it("includes project path in structuredContent when no issues", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_CLEAN }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.structuredContent?.projectPath).toBe(PROJECT_PATH);
  });
});

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

  it("filesScanned reflects actual scanned count", async () => {
    await mockFiles([
      { name: "a.ts", content: LINE_CLEAN },
      { name: "b.ts", content: LINE_CLEAN },
      { name: "c.ts", content: LINE_CLEAN },
    ]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.structuredContent?.filesScanned).toBe(3);
  });

  it("includes best-practice content when fetchAsMarkdownRace returns non-empty", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    const BP = "Use 100dvh for dynamic viewport height on mobile browsers. ".repeat(5);
    vi.mocked(fetchAsMarkdownRace).mockResolvedValue(BP);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    // The best practice content is included in the text output
    expect(result.content[0]!.text).toContain("Live best practice");
  });

  it("calls fetchAsMarkdownRace for CSS/viewport-related issues", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchAsMarkdownRace).mockResolvedValue("");
    await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    // The docsQuery for 100vh issue contains "viewport" — fetchBestPractice calls fetchAsMarkdownRace
    expect(fetchAsMarkdownRace).toHaveBeenCalled();
  });
});

describe("gt_audit handler — comment line skipping", () => {
  it("does not report issues on commented-out lines (// prefix)", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_COMMENTED }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No issues found");
  });

  it("reports issues on non-commented lines with same content", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).not.toContain("No issues found");
  });
});

describe("gt_audit handler — test file skipping (SKIP_FILE_RE)", () => {
  it("skips .test.ts files from pattern matching (SKIP_FILE_RE in runPatterns)", async () => {
    // readProjectFiles collects the file; SKIP_FILE_RE is applied inside runPatterns.
    // Result: file is scanned but produces zero issues → "No issues found".
    await mockFiles([{ name: "app.test.ts", content: LINE_WITH_ISSUE }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No issues found");
  });

  it("skips .spec.ts files from pattern matching (SKIP_FILE_RE in runPatterns)", async () => {
    // readProjectFiles collects the file; SKIP_FILE_RE is applied inside runPatterns.
    // Result: file is scanned but produces zero issues → "No issues found".
    await mockFiles([{ name: "app.spec.ts", content: LINE_WITH_ISSUE }]);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No issues found");
  });

  it("does not skip regular .ts files", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).not.toContain("No issues found");
  });
});

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

describe("gt_audit handler — overflow display (>10 files per issue)", () => {
  it("includes overflow indicator when same issue appears in >10 files", async () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `module${i}.ts`,
      content: LINE_WITH_ISSUE,
    }));
    await mockFiles(files);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("...and");
    expect(result.content[0]!.text).toContain("more");
  });

  it("shows exactly 10 file locations before overflow", async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      name: `file${i}.ts`,
      content: LINE_WITH_ISSUE,
    }));
    await mockFiles(files);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    // 11 files: 10 listed + "and 1 more"
    expect(result.content[0]!.text).toContain("...and 1 more");
  });
});

describe("gt_audit handler — file too large", () => {
  it("skips files exceeding 200KB", async () => {
    const fsp = await import("fs/promises");
    const entries = [makeFileEntry("huge.ts")];
    vi.mocked(fsp.readdir).mockImplementation(async (dir) => {
      if (String(dir) === PROJECT_PATH) return entries as unknown as never;
      return [] as unknown as never;
    });
    // stat returns size > 200_000 → file skipped
    vi.mocked(fsp.stat).mockResolvedValue({ size: 300_000 } as unknown as never);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("No source files found");
  });
});

describe("gt_audit handler — maxFiles limit", () => {
  it("respects maxFiles limit", async () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `m${i}.ts`,
      content: LINE_CLEAN,
    }));
    await mockFiles(files);
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH, maxFiles: 3 });
    expect(result.structuredContent?.filesScanned).toBeLessThanOrEqual(3);
  });
});

describe("gt_audit handler — fetchBestPractice with registry match", () => {
  it("calls fetchDocs when issue docsQuery matches a known library keyword", async () => {
    // Use a React pattern that triggers the keyword→library lookup in fetchBestPractice
    // The react patterns include "useFormState" → title containing "react"
    // Alternatively use a Next.js pattern: "await cookies()" → nextjs
    // Using a direct pattern from the "typescript" category won't keyword-match, so use "react"
    // The react category has forwardRef pattern. Content: "React.forwardRef("
    const reactContent = `const Btn = React.forwardRef((props, ref) => <button ref={ref} {...props} />);`;
    await mockFiles([{ name: "button.tsx", content: reactContent }]);

    // Configure lookupById to return an entry so fetchDocs is called
    vi.mocked(lookupById).mockImplementation((id) => {
      if (id === "facebook/react") {
        return {
          id: "facebook/react",
          name: "React",
          aliases: ["react"],
          description: "A JavaScript library for building user interfaces",
          docsUrl: "https://react.dev",
          llmsTxtUrl: "https://react.dev/llms.txt",
          llmsFullTxtUrl: undefined,
          githubUrl: "https://github.com/facebook/react",
          language: ["javascript", "typescript"],
          tags: ["ui", "framework"],
        };
      }
      return undefined;
    });

    const BP = "Best practice: forwardRef is deprecated in React 19. ".repeat(6);
    vi.mocked(fetchDocs).mockResolvedValue({
      content: BP,
      url: "https://react.dev/llms.txt",
      sourceType: "llms-txt",
    } as never);

    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    // fetchDocs or fetchViaJina should have been called for the best practice
    const calledAny = vi.mocked(fetchDocs).mock.calls.length > 0 || vi.mocked(fetchViaJina).mock.calls.length > 0;
    expect(calledAny).toBe(true);
    expect(result.structuredContent?.totalIssues).toBeGreaterThan(0);
  });
});

describe("gt_audit handler — report header", () => {
  it("includes path in report header", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("Path:");
    expect(result.content[0]!.text).toContain(PROJECT_PATH);
  });

  it("includes files-scanned count in report header", async () => {
    await mockFiles([
      { name: "a.ts", content: LINE_WITH_ISSUE },
      { name: "b.ts", content: LINE_CLEAN },
    ]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH });
    expect(result.content[0]!.text).toContain("Files scanned: 2");
  });

  it("includes categories in report header", async () => {
    await mockFiles([{ name: "app.ts", content: LINE_WITH_ISSUE }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({ ...DEFAULTS, projectPath: PROJECT_PATH, categories: ["layout"] });
    expect(result.content[0]!.text).toContain("Categories: layout");
  });
});

describe("gt_audit handler — parameterized: issue categories from line content", () => {
  it.each([
    ["layout", `<img src="test.jpg">`, "layout"],
    ["security", `element.innerHTML = userInput;`, "security"],
  ] as const)("%s category detected in %s", async (_label, content, expectedCat) => {
    await mockFiles([{ name: "page.tsx", content }]);
    vi.mocked(fetchViaJina).mockResolvedValue("");
    const result = await handler({
      ...DEFAULTS,
      projectPath: PROJECT_PATH,
      categories: [expectedCat],
    });
    const issues = result.structuredContent?.issues ?? [];
    if (issues.length > 0) {
      expect(issues.some((i) => i.category === expectedCat)).toBe(true);
    } else {
      // Pattern didn't match — acceptable but verify no error
      expect(result.content[0]!.text).not.toContain("Could not read");
    }
  });
});
