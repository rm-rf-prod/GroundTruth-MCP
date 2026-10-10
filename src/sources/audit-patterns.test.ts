import { describe, it, expect } from "vitest";
import { AUDIT_PATTERNS, S, type AuditPattern } from "./audit-patterns.js";

// Shell-call names built at runtime, same convention as audit-patterns.ts.
const RUN = S.cmdRun;
const FORK = S.cmdFork;

function pattern(title: string): AuditPattern {
  const p = AUDIT_PATTERNS.find((x) => x.title === title);
  if (!p) throw new Error(`Pattern not found: ${title}`);
  return p;
}

function hits(title: string, line: string, content = line): boolean {
  return pattern(title).test(line, content, 0, content.split("\n"), 0, "x.tsx") !== null;
}

function ms(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

describe("audit pattern advice is current", () => {
  it("middleware: deprecated in Next.js 16, not silently broken; keep it for the edge runtime", () => {
    const p = pattern("middleware.ts is deprecated in Next.js 16 (renamed to proxy.ts)");
    expect(p.severity).toBe("medium");
    expect(p.detail).not.toMatch(/silent/i);
    expect(p.fix).toContain("middleware-to-proxy");
    expect(p.fix).toMatch(/edge runtime/);
    expect(p.fix).toMatch(/15 or earlier/);
    expect(hits(p.title, "export function middleware(request: NextRequest) {")).toBe(true);
  });

  it("Angular: *ngIf/*ngFor/*ngSwitch are deprecated since v20", () => {
    const title = "Legacy *ngIf / *ngFor structural directive";
    expect(pattern(title).severity).toBe("medium");
    expect(pattern(title).detail).toContain("Angular 20");
    expect(pattern(title).fix).toContain("@switch");
    expect(hits(title, `<p *ngSwitchCase="'a'">A</p>`)).toBe(true);
    expect(hits(title, "<p *ngSwitchDefault>none</p>")).toBe(true);
    expect(hits(title, `<div [ngSwitch]="mode">`)).toBe(false);
  });

  it("Angular @Input: no readonly advice for decorator inputs (style guide); points to input()", () => {
    const p = pattern("Mutable @Input() property");
    expect(p.fix).not.toContain("@Input() readonly");
    expect(p.fix).toContain("input<");
  });

  it("forwardRef is unnecessary in React 19, not yet deprecated", () => {
    const p = AUDIT_PATTERNS.find((x) => x.category === "react" && x.title.includes("forwardRef"));
    expect(p?.title).not.toMatch(/deprecated/i);
    expect(p?.detail).toMatch(/future release/);
  });

  it("next/image advice uses preload, not the priority prop Next.js 16 deprecated", () => {
    for (const title of ["Missing loading='lazy' on image", "Missing fetchpriority on LCP image"]) {
      expect(pattern(title).fix).not.toContain("priority={true}");
      expect(pattern(title).fix).toContain("preload");
    }
  });

  it("100vh fallback advice is valid CSS", () => {
    expect(pattern("100vh — use 100dvh for mobile viewport").fix).not.toContain("min(100vh, 100dvh)");
  });

  it("Python password hashing no longer recommends passlib", () => {
    const fix = pattern("MD5 or SHA1 used for password hashing").fix;
    expect(fix).not.toContain("passlib");
    expect(fix).toContain("pwdlib");
  });

  it("React Native touchables are accessible by default; aria-label counts as a label", () => {
    const title = "Missing accessible prop on touchable element";
    expect(pattern(title).fix).not.toMatch(/Add accessible=\{true\}/);
    expect(hits(title, `<Pressable aria-label="Close" onPress={close}>`)).toBe(false);
    expect(hits(title, "<Pressable onPress={close}>")).toBe(true);
  });

  it("Express route-handler advice reflects Express 5 async error forwarding", () => {
    expect(pattern("Route handler without try/catch").detail).toContain("Express 5");
  });

  it("reduced-motion CSS docs query cites a real WCAG criterion", () => {
    expect(pattern("Missing prefers-reduced-motion for animation").docsQuery).toContain("2.3.3");
  });
});

describe("audit patterns stay linear on long lines", () => {
  const cases: Array<[string, string]> = [
    ["SQL injection via f-string or % formatting", "f'.execute(".repeat(1_500)],
    ["onClick on non-interactive element — WCAG 2.1.1", "@ts-ignore" + "<p ".repeat(30_000)],
    ["Render-blocking <script> without async or defer", "<script ".repeat(12_000)],
    ["Icon-only button missing aria-label", "<button ".repeat(12_000)],
    ["Inline style object on View or Text", "<View {".repeat(12_000)],
    ["Image missing alt — WCAG 1.1.1 failure", "Image ".repeat(15_000)],
    ["subprocess with shell=True", "subprocess.run(/".repeat(6_000)],
    ["requests with verify=False — TLS validation disabled", "requests.get(/".repeat(6_000)],
    ["Mutable default argument", "def f(".repeat(15_000)],
    ["Command injection — shell exec with dynamic input", `${RUN}(`.repeat(20_000)],
    ["Path traversal — file system access with user input", "readFile(".repeat(10_000)],
    ["Route handler exposes error stack trace", ".json({".repeat(13_000)],
  ];
  for (const [title, line] of cases) {
    it(`${title} (${line.length} chars)`, () => {
      expect(ms(() => hits(title, line))).toBeLessThan(250);
    });
  }

  it("!important overuse does not rescan the whole file for every line", () => {
    const lines = Array.from({ length: 6000 }, (_, i) => `.u${i}{margin:${i}px!important}`);
    const content = lines.join("\n");
    const p = pattern("!important overuse");
    let flagged = 0;
    const t = ms(() => {
      for (const l of lines) if (p.test(l, content, 0, lines, 0) !== null) flagged++;
    });
    expect(flagged).toBe(6000);
    expect(t).toBeLessThan(100);
  });

  it("!important overuse threshold stays at more than 3 per file", () => {
    const three = "a{x:1!important}\nb{x:1!important}\nc{x:1!important}";
    expect(hits("!important overuse", "a{x:1!important}", three)).toBe(false);
    expect(hits("!important overuse", "a{x:1!important}", `${three}\nd{x:1!important}`)).toBe(true);
    expect(hits("!important overuse", "a{x:1}", `${three}\nd{x:1!important}`)).toBe(false);
  });

  it("keeps matching the shapes it matched before", () => {
    const sql = "SQL injection via f-string or % formatting";
    expect(hits(sql, `cursor.execute(f"SELECT * FROM t WHERE id = {uid}")`)).toBe(true);
    expect(hits(sql, `cursor.execute("SELECT * FROM t WHERE id = %s" % uid)`)).toBe(true);
    expect(hits(sql, `cursor.execute("SELECT * FROM t WHERE id = {}".format(uid))`)).toBe(true);
    expect(hits(sql, `cursor.execute("SELECT * FROM t WHERE id = %s", (uid,))`)).toBe(false);
    expect(hits(sql, `cursor.execute(f"SELECT 1")`)).toBe(false);
    expect(hits("onClick on non-interactive element — WCAG 2.1.1", `<div className="row" onClick={open}>`)).toBe(true);
    expect(hits("Render-blocking <script> without async or defer", `<script type="text/javascript" src="/a.js">`)).toBe(true);
    expect(hits("Icon-only button missing aria-label", `<button type="button"><svg viewBox="0 0 1 1" />`)).toBe(true);
    expect(hits("Inline style object on View or Text", `<Text numberOfLines={2} style={{ flex: 1 }}>`)).toBe(true);
    // A "<" comparison inside an attribute expression must not end the tag scan.
    const click = "onClick on non-interactive element — WCAG 2.1.1";
    expect(hits(click, `<li key={i} className={i < step ? "done" : ""} onClick={() => go(i)}>`)).toBe(true);
    expect(hits(click, `<div className={cn("star", n <= rating && "on")} onClick={() => rate(n)}>`)).toBe(true);
    expect(hits("Icon-only button missing aria-label", `<button disabled={page <= 1}><svg viewBox="0 0 24 24" /></button>`)).toBe(true);
    expect(hits("Inline style object on View or Text", `<View pointerEvents={a < b ? "auto" : "none"} style={{ flex: 1 }}>`)).toBe(true);
    expect(hits("Render-blocking <script> without async or defer", `<script data-on={a < b} src="/a.js">`)).toBe(true);
    expect(hits("Image missing alt — WCAG 1.1.1 failure", `<Image width={4} src="/a.png" />`)).toBe(true);
    expect(hits("Image missing alt — WCAG 1.1.1 failure", `<Image src="/a.png" alt="" />`)).toBe(false);
    expect(hits("Mutable default argument", "def f(a, b=set()):")).toBe(true);
    const cmd = "Command injection — shell exec with dynamic input";
    expect(hits(cmd, `${RUN}Sync(join(\`rm \${dir}\`));`)).toBe(true);
    expect(hits(cmd, `${RUN}(a); ${FORK}(\`ls \${dir}\`);`)).toBe(true);
    expect(hits(cmd, `${RUN}(a); const s = \`\${b}\`;`)).toBe(false);
    const fsHit = "Path traversal — file system access with user input";
    expect(hits(fsHit, "readFile(path.join(base, req.params.f))")).toBe(true);
    expect(hits(fsHit, "readFile(a); readFileSync(body.path)")).toBe(true);
    expect(hits(fsHit, "readFile(a); log(req.url)")).toBe(false);
    const leak = "Route handler exposes error stack trace";
    expect(hits(leak, "res.json({ ok: false, msg: err.message })")).toBe(true);
    expect(hits(leak, "res.json({ ok: false }); log(err.message)")).toBe(false);
  });
});
