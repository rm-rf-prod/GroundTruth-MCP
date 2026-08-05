import { describe, it, expect } from "vitest";
import { AUDIT_PATTERNS, buildCommentMap } from "./audit.js";

// Helper: run all patterns of a given category against a single line
function testLine(category: string, line: string): string[] {
  return AUDIT_PATTERNS
    .filter((p) => p.category === category)
    .filter((p) => p.test(line, line, 0, [line], 0) !== null)
    .map((p) => p.title);
}

// Helper: check a specific pattern by title
function matchesPattern(title: string, line: string, context?: string[]): boolean {
  const pattern = AUDIT_PATTERNS.find((p) => p.title === title);
  if (!pattern) throw new Error(`Pattern not found: ${title}`);
  const lines = context ?? [line];
  const idx = lines.indexOf(line);
  return pattern.test(line, lines.join("\n"), 0, lines, idx === -1 ? 0 : idx) !== null;
}

// ── buildCommentMap ───────────────────────────────────────────────────────────

describe("buildCommentMap", () => {
  it("returns empty set for content with no block comments", () => {
    const map = buildCommentMap("const x = 1;\nconst y = 2;");
    expect(map.size).toBe(0);
  });

  it("marks offsets inside /* */ block comments", () => {
    const content = "/* comment */\nconst x = 1;";
    const map = buildCommentMap(content);
    // offset 0 is inside the block comment
    expect(map.has(0)).toBe(true);
  });

  it("does not mark lines after block comment closes", () => {
    const content = "/* start\nend */\nconst x = 1;";
    const map = buildCommentMap(content);
    // "const x = 1;" starts at offset 15 (after "/* start\nend */\n")
    const afterClose = content.indexOf("const x");
    expect(map.has(afterClose)).toBe(false);
  });

  it("ignores /* inside string literals so following code is still audited", () => {
    const content = `const glob = "**/*.spec.ts";\neval(userInput);`;
    const map = buildCommentMap(content);
    expect(map.has(content.indexOf("eval"))).toBe(false);
  });

  it("ignores /* inside template literals and // comments", () => {
    const content = "const g = `src/**/*.ts`;\n// not /* an opener\nconst y = 2;";
    const map = buildCommentMap(content);
    expect(map.has(content.indexOf("const y"))).toBe(false);
    expect(map.size).toBe(0);
  });

  it("still marks a real block comment that follows a string containing /*", () => {
    const content = `const glob = "**/*.spec.ts";\n/* real comment */\nconst z = 3;`;
    const map = buildCommentMap(content);
    expect(map.has(content.indexOf("real comment"))).toBe(true);
    expect(map.has(content.indexOf("const z"))).toBe(false);
  });
});

// ── Python patterns ───────────────────────────────────────────────────────────
