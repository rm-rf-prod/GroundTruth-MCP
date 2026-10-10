import { describe, it, expect } from "vitest";
import { sanitizeContent, stripMdxResidue } from "./sanitize.js";

// TOK-10: MDX page chrome that reaches clients as plain text. Line-anchored and
// fence-aware, because the same markup inside a code sample is real code.
describe("sanitizeContent — MDX residue", () => {
  it("drops heading ids in both MDX forms", () => {
    expect(sanitizeContent("## Returns {/*returns*/}\ntext")).toBe("## Returns\ntext");
    expect(sanitizeContent("### Custom id {#custom-id}\ntext")).toBe("### Custom id\ntext");
    expect(sanitizeContent("## Twice {/*a*/} {#b}\ntext")).toBe("## Twice\ntext");
    expect(sanitizeContent("## Implicit relations [#implicit-relations]\ntext")).toBe("## Implicit relations\ntext");
    expect(sanitizeContent("### Fix crash [#1234]\ntext")).toBe("### Fix crash [#1234]\ntext");
    expect(sanitizeContent("## See [the step](#step) {#see}\ntext")).toBe("## See the step\ntext");
  });

  // These took 30 s and more when one regex matched the heading and its ids.
  it("stays fast on a huge heading line that does not end in an id", () => {
    const timed = (strip: (s: string) => string, md: string) => {
      const start = performance.now();
      expect(strip(md)).toBe(md);
      expect(performance.now() - start).toBeLessThan(500);
    };
    timed(sanitizeContent, `# h${" {#a}".repeat(40_000)}x`);
    timed(sanitizeContent, `## h${" {/*x*/}".repeat(25_000)} tail`);
    // Directly: a 200 KB space run is also quadratic in a nav-footer pattern.
    timed(stripMdxResidue, `# h${" ".repeat(200_000)}x`);
  });

  it("keeps a JSX comment that is not a heading id", () => {
    expect(sanitizeContent("Prose with {/* note */} inside.")).toBe("Prose with {/* note */} inside.");
  });

  it("drops lines that are only an MDX page-chrome tag", () => {
    const md = "<Intro>\n\nUse effects to sync.\n\n</Intro>\n\n<InlineToc />\n\n<YouWillLearn isChapter={true}>\n- one\n  </YouWillLearn>\n<DeepDive>\nwhy\n</DeepDive>";
    expect(sanitizeContent(md)).toBe("\nUse effects to sync.\n\n\n- one\nwhy\n");
  });

  // gt_examples passes raw GitHub code-search fragments, which are not fenced.
  it("keeps JSX component lines in unfenced source", () => {
    const jsx = [
      "ReactDOM.createRoot(document.getElementById('root')!).render(",
      "  <React.StrictMode>",
      "  <QueryClientProvider client={queryClient}>",
      "      <App />",
      "  </QueryClientProvider>",
      "  </React.StrictMode>,",
      ")",
      "<Layout title=\"Home\">",
      "  <Header />",
      "<Tabs>",
      "</Layout>",
    ].join("\n");
    expect(sanitizeContent(jsx)).toBe(jsx);
  });

  it("keeps tags that share a line with text, lowercase HTML and indented code", () => {
    const md = "Wrap it in <Suspense> like this.\n<details>\n    <Stack>";
    expect(sanitizeContent(md)).toBe(md);
  });

  it("turns in-page anchor links into their text", () => {
    expect(sanitizeContent("See [the cleanup step](#cleanup) and [API](https://x.dev/a#b).")).toBe(
      "See the cleanup step and [API](https://x.dev/a#b).",
    );
  });

  it("never touches code fences", () => {
    const md = [
      "```jsx",
      "<Tabs>",
      "## Not a heading {/*id*/}",
      "[jump](#top)",
      "</Tabs>",
      "```",
      "~~~",
      "<Note />",
      "~~~",
    ].join("\n");
    expect(sanitizeContent(md)).toBe(md);
  });

  it("leaves the rest of an unclosed fence alone", () => {
    const md = "```tsx\n<Tabs>\n[x](#y)";
    expect(sanitizeContent(md)).toBe(md);
  });

  it("is idempotent past the memo threshold", () => {
    const doc = `${"## Section {/*s*/}\n<Pitfall>\nBody [a](#a) text.\n</Pitfall>\n".repeat(200)}tail`;
    const once = sanitizeContent(doc);
    expect(once.length).toBeGreaterThan(4_096);
    expect(sanitizeContent(`${once}\nunique`)).toBe(`${once}\nunique`);
  });
});
