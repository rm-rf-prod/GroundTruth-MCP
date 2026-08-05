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

describe("Security audit patterns", () => {
  it("flags dangerouslySetInnerHTML without sanitization", () => {
    const matches = testLine("security", `<div dangerouslySetInnerHTML={{ __html: userContent }} />`);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("flags hardcoded API key pattern", () => {
    const matches = testLine("security", `const apiKey = "abcdefghijklmnopqrstuvwxyz1234";`);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("flags eval() in JS/TS", () => {
    const matches = testLine("security", `const result = eval(userCode);`);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ── TypeScript patterns ───────────────────────────────────────────────────────

describe("TypeScript audit patterns", () => {
  it("flags 'any' type annotation", () => {
    const matches = testLine("typescript", `function handle(data: any): void {`);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("flags non-null assertion", () => {
    const matches = testLine("typescript", `const value = map.get(key)!.toString();`);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("flags @ts-ignore comment", () => {
    const matches = testLine("typescript", `// @ts-ignore`);
    // @ts-ignore line starts with //, so it should be skipped by comment detection —
    // but our test calls pattern.test() directly, bypassing comment skip logic
    // The pattern should still match the string content
    const pattern = AUDIT_PATTERNS.find((p) => p.title.includes("ts-ignore"));
    expect(pattern).toBeDefined();
    expect(pattern?.test("// @ts-ignore", "// @ts-ignore", 0, ["// @ts-ignore"], 0)).not.toBeNull();
  });
});

// ── React patterns ────────────────────────────────────────────────────────────

describe("React audit patterns", () => {
  it("flags array index as key", () => {
    const matches = testLine("react", `items.map((item, idx) => <Item key={idx} />)`);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("flags useFormState (renamed to useActionState)", () => {
    const matches = testLine("react", `const [state, action] = useFormState(serverAction, null);`);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ── Node patterns ────────────────────────────────────────────────────────────

describe("Node audit patterns", () => {
  it("flags console.log", () => {
    const matches = testLine("node", `console.log("user data:", user);`);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("flags plain http:// fetch", () => {
    const matches = testLine("node", `const res = await fetch("http://api.example.com/data");`);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ── Vue patterns ──────────────────────────────────────────────────────────────

describe("Vue audit patterns", () => {
  it("flags v-for without :key", () => {
    expect(matchesPattern("v-for without :key", '<li v-for="item in items">{{ item }}</li>')).toBe(true);
  });

  it("does not flag v-for with :key", () => {
    expect(matchesPattern("v-for without :key", '<li v-for="item in items" :key="item.id">{{ item }}</li>')).toBe(false);
  });

  it("flags direct prop mutation", () => {
    expect(matchesPattern("Mutating props directly", "props.count = 5;")).toBe(true);
  });

  it("does not flag props read access", () => {
    expect(matchesPattern("Mutating props directly", "const n = props.count;")).toBe(false);
  });

  it("flags Options API data() in Composition API project", () => {
    expect(matchesPattern("Options API data() in Composition API project", "  data() {")).toBe(true);
  });
});

// ── Svelte patterns ───────────────────────────────────────────────────────────

describe("Svelte audit patterns", () => {
  it("flags $: reactive declaration (Svelte 4 syntax)", () => {
    expect(matchesPattern("Svelte 4 reactive declaration in Svelte 5 project", "$: doubled = count * 2;")).toBe(true);
  });

  it("does not flag $state (Svelte 5 syntax)", () => {
    expect(matchesPattern("Svelte 4 reactive declaration in Svelte 5 project", "let count = $state(0);")).toBe(false);
  });

  it("flags on:click directive (Svelte 4 syntax)", () => {
    expect(matchesPattern("Svelte 4 event directive in Svelte 5 project", '<button on:click={handleClick}>Click</button>')).toBe(true);
  });

  it("does not flag onclick attribute (Svelte 5 syntax)", () => {
    expect(matchesPattern("Svelte 4 event directive in Svelte 5 project", '<button onclick={handleClick}>Click</button>')).toBe(false);
  });

  it("flags createEventDispatcher usage", () => {
    expect(matchesPattern("Svelte 4 createEventDispatcher in Svelte 5 project", "const dispatch = createEventDispatcher();")).toBe(true);
  });

  it("does not flag unrelated dispatcher variable", () => {
    expect(matchesPattern("Svelte 4 createEventDispatcher in Svelte 5 project", "const dispatch = store.dispatch;")).toBe(false);
  });
});

// ── Angular patterns ──────────────────────────────────────────────────────────

describe("Angular audit patterns", () => {
  it("flags subscription in ngOnInit without takeUntilDestroyed", () => {
    expect(matchesPattern(
      "Manual subscription without cleanup in ngOnInit",
      "this.service$.subscribe(data => { this.data = data; });",
      ["ngOnInit() {", "this.service$.subscribe(data => { this.data = data; });", "}"],
    )).toBe(true);
  });

  it("does not flag subscription when takeUntilDestroyed is present", () => {
    expect(matchesPattern(
      "Manual subscription without cleanup in ngOnInit",
      "this.service$.subscribe(data => { this.data = data; });",
      ["ngOnInit() {", "this.service$.subscribe(data => { this.data = data; });", "takeUntilDestroyed", "}"],
    )).toBe(false);
  });

  it("flags mutable @Input()", () => {
    expect(matchesPattern("Mutable @Input() property", "@Input() title: string = '';")).toBe(true);
  });

  it("does not flag readonly @Input()", () => {
    expect(matchesPattern("Mutable @Input() property", "@Input() readonly title: string = '';")).toBe(false);
  });

  it("flags *ngIf structural directive", () => {
    expect(matchesPattern("Legacy *ngIf / *ngFor structural directive", '<div *ngIf="isVisible">')).toBe(true);
  });

  it("flags *ngFor structural directive", () => {
    expect(matchesPattern("Legacy *ngIf / *ngFor structural directive", '<li *ngFor="let item of items">')).toBe(true);
  });

  it("does not flag @if block syntax", () => {
    expect(matchesPattern("Legacy *ngIf / *ngFor structural directive", "@if (isVisible) {")).toBe(false);
  });
});

// ── Testing patterns ──────────────────────────────────────────────────────────
