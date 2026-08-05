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

describe("SEO audit patterns", () => {
  it("flags img without alt", () => {
    expect(matchesPattern("img element missing alt attribute", '<img src="photo.jpg" class="hero" />')).toBe(true);
  });

  it("does not flag img with alt", () => {
    expect(matchesPattern("img element missing alt attribute", '<img src="photo.jpg" alt="Hero" />')).toBe(false);
  });

  it("does not flag img with empty alt (decorative)", () => {
    expect(matchesPattern("img element missing alt attribute", '<img src="bg.jpg" alt="" />')).toBe(false);
  });

  it("flags Next.js page without generateMetadata", () => {
    expect(matchesPattern(
      "Missing generateMetadata in Next.js page",
      "export default function Page() {",
      ["export default function Page() {", "  return <main>Hello</main>;", "}"],
    )).toBe(true);
  });

  it("does not flag page that already has generateMetadata", () => {
    expect(matchesPattern(
      "Missing generateMetadata in Next.js page",
      "export default function Page() {",
      [
        "export async function generateMetadata() { return { title: 'Page' }; }",
        "export default function Page() {",
        "  return <main>Hello</main>;",
        "}",
      ],
    )).toBe(false);
  });

  it("flags hardcoded <title> tag in JSX", () => {
    expect(matchesPattern("Hardcoded <title> tag in JSX", "  <title>My App</title>")).toBe(true);
  });

  it("does not flag <title> with dynamic content (template expression)", () => {
    expect(matchesPattern("Hardcoded <title> tag in JSX", "  <title>{title}</title>")).toBe(false);
  });
});

// ── i18n patterns ─────────────────────────────────────────────────────────────

describe("i18n audit patterns", () => {
  it("flags hardcoded dollar currency concatenation", () => {
    expect(matchesPattern("Hardcoded currency symbol", "const label = '$' + price;")).toBe(true);
  });

  it("flags template literal dollar currency", () => {
    expect(matchesPattern("Hardcoded currency symbol", "const label = `$${price}`;")).toBe(true);
  });

  it("flags toLocaleDateString without locale argument", () => {
    expect(matchesPattern("toLocaleDateString without locale argument", "const str = date.toLocaleDateString();")).toBe(true);
  });

  it("does not flag toLocaleDateString with locale argument", () => {
    expect(matchesPattern("toLocaleDateString without locale argument", "date.toLocaleDateString('de-DE')")).toBe(false);
  });

  it("flags toLocaleString without locale argument", () => {
    expect(matchesPattern("toLocaleString without locale argument", "const formatted = value.toLocaleString();")).toBe(true);
  });

  it("does not flag toLocaleString with locale argument", () => {
    expect(matchesPattern("toLocaleString without locale argument", "value.toLocaleString('de-DE')")).toBe(false);
  });
});

// ── Category coverage ─────────────────────────────────────────────────────────

describe("AUDIT_PATTERNS category coverage", () => {
  const categories = ["layout", "performance", "accessibility", "security", "react", "nextjs", "typescript", "node", "python", "vue", "svelte", "angular", "testing", "mobile", "api", "css", "seo", "i18n"];

  for (const cat of categories) {
    it(`has at least 3 patterns in category: ${cat}`, () => {
      const count = AUDIT_PATTERNS.filter((p) => p.category === cat).length;
      expect(count).toBeGreaterThanOrEqual(3);
    });
  }

  it("all patterns have required fields", () => {
    for (const p of AUDIT_PATTERNS) {
      expect(p.category.length).toBeGreaterThan(0);
      expect(["critical", "high", "medium", "low"]).toContain(p.severity);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.detail.length).toBeGreaterThan(0);
      expect(p.fix.length).toBeGreaterThan(0);
      expect(typeof p.test).toBe("function");
    }
  });
});

describe("charOffset is honoured for repeated identical lines", () => {
  // Regression for the indexOf(line) bug: context-window patterns must inspect
  // the match's real position (charOffset), not the FIRST occurrence of the line.
  it("flags the second identical <FlatList> whose own context lacks keyExtractor", () => {
    const TARGET = "<FlatList data={items} />";
    const content =
      `${TARGET}\nkeyExtractor={(i) => i.id}\n` +
      "// padding line to push the second match past the 500-char window\n".repeat(20) +
      `${TARGET}\n`;
    const lines = content.split("\n");
    const secondOffset = content.lastIndexOf(TARGET);
    const secondLineIndex = lines.lastIndexOf(TARGET);
    const pattern = AUDIT_PATTERNS.find((p) => p.title === "FlatList without keyExtractor");
    if (!pattern) throw new Error("pattern not found");

    // First occurrence (offset 0) has keyExtractor within its window -> not flagged.
    expect(pattern.test(TARGET, content, 0, lines, 0)).toBeNull();
    // Second occurrence: the old indexOf(line) code would re-inspect offset 0 and
    // wrongly see keyExtractor. With charOffset it inspects the real position and flags it.
    expect(pattern.test(TARGET, content, secondOffset, lines, secondLineIndex)).toBe(TARGET);
  });
});

// ── StyleSheet.create pattern — ReDoS guard ───────────────────────────────────

describe("StyleSheet.create pattern ReDoS guard", () => {
  const pattern = AUDIT_PATTERNS.find((p) => p.title === "StyleSheet.create inside component body");

  it("completes instantly on long builder chains with no arrow function", () => {
    if (!pattern) throw new Error("pattern not found");
    // Pre-fix, the ambiguous alternation backtracked exponentially on exactly
    // this shape (~14s at 26 repeats); 150 repeats would hang for years.
    const line = "const styles = StyleSheet.create({ a: { flex: 1 } });";
    const content =
      "const schema = Yup.object()" + ".shape({a:1})".repeat(150) + ";\nreturn (\n" + line;
    const lines = content.split("\n");
    const start = performance.now();
    pattern.test(line, content, content.indexOf("StyleSheet.create"), lines, lines.length - 1);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("still flags StyleSheet.create inside a component with default-param props", () => {
    if (!pattern) throw new Error("pattern not found");
    const line = "  const styles = StyleSheet.create({ x: {} });";
    const content =
      "const Component = (props = {}) => {\n  return (\n    <View />\n  );\n" + line + "\n};";
    const lines = content.split("\n");
    expect(
      pattern.test(line, content, content.indexOf("StyleSheet.create"), lines, 4),
    ).toBe(line);
  });
});
