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

describe("Testing audit patterns", () => {
  it("flags test.only committed", () => {
    expect(matchesPattern("test.only / it.only committed", "test.only('my test', () => {")).toBe(true);
  });

  it("flags it.only committed", () => {
    expect(matchesPattern("test.only / it.only committed", "  it.only('should work', () => {")).toBe(true);
  });

  it("does not flag plain test()", () => {
    expect(matchesPattern("test.only / it.only committed", "test('my test', () => {")).toBe(false);
  });

  it("flags waitForTimeout in test", () => {
    expect(matchesPattern("waitForTimeout / sleep in test", "await page.waitForTimeout(1000);")).toBe(true);
  });

  it("flags console.log inside test body", () => {
    expect(matchesPattern("console.log inside test body", "    console.log(response);")).toBe(true);
  });

  it("does not flag console.log at word boundary (blueprint)", () => {
    expect(matchesPattern("console.log inside test body", "// console.log(response);")).toBe(false);
  });
});

// ── Mobile patterns ───────────────────────────────────────────────────────────

describe("Mobile audit patterns", () => {
  it("flags FlatList without keyExtractor", () => {
    expect(matchesPattern(
      "FlatList without keyExtractor",
      "<FlatList data={items} renderItem={renderItem} />",
      ["<FlatList data={items} renderItem={renderItem} />"],
    )).toBe(true);
  });

  it("does not flag FlatList with keyExtractor", () => {
    expect(matchesPattern(
      "FlatList without keyExtractor",
      "<FlatList data={items} renderItem={renderItem} />",
      ["<FlatList data={items} keyExtractor={(item) => item.id} renderItem={renderItem} />"],
    )).toBe(false);
  });

  it("flags TouchableOpacity without accessibilityLabel", () => {
    expect(matchesPattern(
      "Missing accessible prop on touchable element",
      "<TouchableOpacity onPress={handlePress}>",
      ["<TouchableOpacity onPress={handlePress}>"],
    )).toBe(true);
  });

  it("does not flag TouchableOpacity with accessibilityLabel", () => {
    expect(matchesPattern(
      "Missing accessible prop on touchable element",
      "<TouchableOpacity onPress={handlePress}>",
      ["<TouchableOpacity onPress={handlePress}>", '  accessibilityLabel="Open menu"'],
    )).toBe(false);
  });

  it("flags inline style object on View", () => {
    expect(matchesPattern("Inline style object on View or Text", '<View style={{ flex: 1, padding: 16 }}>')).toBe(true);
  });

  it("does not flag View with StyleSheet reference", () => {
    expect(matchesPattern("Inline style object on View or Text", "<View style={styles.container}>")).toBe(false);
  });
});

// ── API patterns ──────────────────────────────────────────────────────────────

describe("API audit patterns", () => {
  it("flags error stack trace exposure", () => {
    expect(matchesPattern("Route handler exposes error stack trace", "res.json({ error: err.stack });")).toBe(true);
  });

  it("does not flag generic error message", () => {
    expect(matchesPattern("Route handler exposes error stack trace", 'res.json({ error: "Internal server error" });')).toBe(false);
  });

  it("flags req.query used without validation", () => {
    expect(matchesPattern("req.query used without validation", "const id = req.query.id;")).toBe(true);
  });

  it("flags route handler without try/catch", () => {
    expect(matchesPattern(
      "Route handler without try/catch",
      "app.get('/users', async (req, res) => {",
      ["app.get('/users', async (req, res) => {", "  const users = await db.find();", "  res.json(users);", "});"],
    )).toBe(true);
  });

  it("does not flag route handler with try/catch", () => {
    expect(matchesPattern(
      "Route handler without try/catch",
      "app.get('/users', async (req, res) => {",
      ["app.get('/users', async (req, res) => {", "  try {", "    const users = await db.find();", "  } catch (e) {}", "});"],
    )).toBe(false);
  });
});

// ── CSS patterns ──────────────────────────────────────────────────────────────

describe("CSS audit patterns", () => {
  it("flags pixel font size", () => {
    expect(matchesPattern("Pixel font sizes instead of rem", "font-size: 16px;")).toBe(true);
  });

  it("does not flag rem font size", () => {
    expect(matchesPattern("Pixel font sizes instead of rem", "font-size: 1rem;")).toBe(false);
  });

  it("does not flag non-font px usage", () => {
    expect(matchesPattern("Pixel font sizes instead of rem", "margin: 8px;")).toBe(false);
  });

  it("flags z-index: 9999 magic number", () => {
    expect(matchesPattern("z-index: 9999 magic number", "z-index: 9999;")).toBe(true);
  });

  it("flags z-index: 99999", () => {
    expect(matchesPattern("z-index: 9999 magic number", "z-index: 99999;")).toBe(true);
  });

  it("does not flag z-index: 10", () => {
    expect(matchesPattern("z-index: 9999 magic number", "z-index: 10;")).toBe(false);
  });

  it("flags animation without prefers-reduced-motion", () => {
    expect(matchesPattern(
      "Missing prefers-reduced-motion for animation",
      "@keyframes spin { to { transform: rotate(360deg); } }",
      ["@keyframes spin { to { transform: rotate(360deg); } }"],
    )).toBe(true);
  });

  it("does not flag animation with prefers-reduced-motion present", () => {
    expect(matchesPattern(
      "Missing prefers-reduced-motion for animation",
      "@keyframes spin { to { transform: rotate(360deg); } }",
      [
        "@keyframes spin { to { transform: rotate(360deg); } }",
        "@media (prefers-reduced-motion: no-preference) { .spinner { animation: spin 1s linear infinite; } }",
      ],
    )).toBe(false);
  });

  it("flags !important overuse when more than 3 occurrences", () => {
    const lines = [
      "color: red !important;",
      "background: blue !important;",
      "margin: 0 !important;",
      "padding: 0 !important;",
    ];
    expect(matchesPattern("!important overuse", "color: red !important;", lines)).toBe(true);
  });

  it("does not flag single !important usage", () => {
    expect(matchesPattern("!important overuse", "color: red !important;", ["color: red !important;"])).toBe(false);
  });
});

// ── SEO patterns ──────────────────────────────────────────────────────────────
