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

describe("Python audit patterns", () => {
  describe("print() in production", () => {
    it("flags print() call", () => {
      expect(matchesPattern("print() in production code", `    print(f"Processing {item}")`)).toBe(true);
    });

    it("does not flag 'blueprint' or 'footprint'", () => {
      // these contain "print" as a substring but not as a function call
      const titles = testLine("python", "blueprint = factory.create()");
      expect(titles).not.toContain("print() in production code");
    });
  });
});
