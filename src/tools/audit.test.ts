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
});

// ── Python patterns ───────────────────────────────────────────────────────────

describe("Python audit patterns", () => {
  describe("SQL injection via f-string", () => {
    it("flags cursor.execute with f-string", () => {
      expect(matchesPattern(
        "SQL injection via f-string or % formatting",
        `cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")`,
      )).toBe(true);
    });

    it("flags cursor.execute with .format()", () => {
      expect(matchesPattern(
        "SQL injection via f-string or % formatting",
        `cursor.execute("SELECT * FROM users WHERE id = {}".format(user_id))`,
      )).toBe(true);
    });

    it("does not flag parameterized query", () => {
      expect(matchesPattern(
        "SQL injection via f-string or % formatting",
        `cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))`,
      )).toBe(false);
    });
  });

  describe("eval() / exec()", () => {
    it("flags eval()", () => {
      expect(matchesPattern("eval() or exec() with dynamic input", `result = eval(user_input)`)).toBe(true);
    });

    it("flags exec()", () => {
      expect(matchesPattern("eval() or exec() with dynamic input", `exec(code_string)`)).toBe(true);
    });

    it("does not flag 'executive' as a false positive", () => {
      expect(matchesPattern("eval() or exec() with dynamic input", `# executive summary`)).toBe(false);
    });
  });

  describe("subprocess shell=True", () => {
    it("flags subprocess.run with shell=True", () => {
      expect(matchesPattern(
        "subprocess with shell=True",
        `subprocess.run(cmd, shell=True)`,
      )).toBe(true);
    });

    it("flags subprocess.call with shell=True", () => {
      expect(matchesPattern(
        "subprocess with shell=True",
        `subprocess.call(["ls"], shell=True)`,
      )).toBe(true);
    });

    it("does not flag subprocess.run without shell=True", () => {
      expect(matchesPattern(
        "subprocess with shell=True",
        `subprocess.run(["ls", "-la"], check=True)`,
      )).toBe(false);
    });
  });

  describe("os.system()", () => {
    it("flags os.system() call", () => {
      expect(matchesPattern("os.system() call — command injection risk", `os.system("ls " + user_dir)`)).toBe(true);
    });

    it("does not flag os.path.exists()", () => {
      expect(matchesPattern("os.system() call — command injection risk", `os.path.exists(filepath)`)).toBe(false);
    });
  });

  describe("bare except", () => {
    it("flags bare except:", () => {
      expect(matchesPattern("Bare except clause swallows all errors", `    except:`)).toBe(true);
    });

    it("does not flag except Exception as e:", () => {
      expect(matchesPattern("Bare except clause swallows all errors", `    except Exception as e:`)).toBe(false);
    });

    it("does not flag except ValueError:", () => {
      expect(matchesPattern("Bare except clause swallows all errors", `    except ValueError:`)).toBe(false);
    });
  });

  describe("pickle.loads()", () => {
    it("flags pickle.loads()", () => {
      expect(matchesPattern("pickle.loads() from untrusted source", `data = pickle.loads(raw_bytes)`)).toBe(true);
    });

    it("flags pickle.load()", () => {
      expect(matchesPattern("pickle.loads() from untrusted source", `obj = pickle.load(f)`)).toBe(true);
    });
  });

  describe("MD5/SHA1 for passwords", () => {
    it("flags hashlib.md5()", () => {
      expect(matchesPattern(
        "MD5 or SHA1 used for password hashing",
        `hashed = hashlib.md5(password.encode()).hexdigest()`,
      )).toBe(true);
    });

    it("flags hashlib.sha1()", () => {
      expect(matchesPattern(
        "MD5 or SHA1 used for password hashing",
        `h = hashlib.sha1(data)`,
      )).toBe(true);
    });

    it("does not flag hashlib.sha256()", () => {
      expect(matchesPattern(
        "MD5 or SHA1 used for password hashing",
        `h = hashlib.sha256(data)`,
      )).toBe(false);
    });
  });

  describe("requests verify=False", () => {
    it("flags requests.get with verify=False", () => {
      expect(matchesPattern(
        "requests with verify=False — TLS validation disabled",
        `resp = requests.get(url, verify=False)`,
      )).toBe(true);
    });

    it("flags requests.post with verify=False", () => {
      expect(matchesPattern(
        "requests with verify=False — TLS validation disabled",
        `resp = requests.post(url, json=body, verify=False)`,
      )).toBe(true);
    });

    it("does not flag requests.get without verify=False", () => {
      expect(matchesPattern(
        "requests with verify=False — TLS validation disabled",
        `resp = requests.get(url, timeout=10)`,
      )).toBe(false);
    });
  });

  describe("mutable default argument", () => {
    it("flags def with list default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def process(items=[]):`,
      )).toBe(true);
    });

    it("flags def with dict default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def build(config={}):`,
      )).toBe(true);
    });

    it("does not flag def with None default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def process(items=None):`,
      )).toBe(false);
    });

    it("does not flag def with string default", () => {
      expect(matchesPattern(
        "Mutable default argument",
        `def greet(name="world"):`,
      )).toBe(false);
    });
  });

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

// ── Security patterns (JS/TS) ────────────────────────────────────────────────

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
