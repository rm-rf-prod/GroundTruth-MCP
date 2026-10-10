import { describe, it, expect } from "vitest";
import { extractRelevantContent } from "./extract.js";

const filler = (word: string): string => `${word} paragraph text goes here. `.repeat(12);

// TOK-10: a heading with no body (a parent of deeper headings) costs tokens and answers nothing.
describe("extractRelevantContent — heading-only sections", () => {
  it("does not ship a matching heading whose section is empty", () => {
    const doc = [
      "## Hooks reference",
      "",
      "### Effect hooks",
      "",
      `Effect hooks sync with external systems. ${filler("hooks")}`,
      "## Hooks FAQ",
      "## Billing",
      filler("billing"),
      "## Invoices",
      filler("invoice"),
    ].join("\n");
    const { text } = extractRelevantContent(doc, "hooks", 300);
    expect(doc.length).toBeGreaterThan(300 * 3.8);
    expect(text).toContain("Effect hooks sync");
    expect(text).not.toContain("Hooks reference");
    expect(text).not.toContain("Hooks FAQ");
  });

  it("keeps the provenance marker of a merged page", () => {
    const doc = [
      "## Source: https://x.dev/docs/hooks",
      "",
      "# Hooks guide",
      `Hooks let components use state. ${filler("hooks")}`,
      "## Billing",
      filler("billing"),
      "## Invoices",
      filler("invoice"),
    ].join("\n");
    const { text } = extractRelevantContent(doc, "hooks", 300);
    expect(doc.length).toBeGreaterThan(300 * 3.8);
    expect(text).toContain("## Source: https://x.dev/docs/hooks");
  });

  it("still returns something when every section is heading-only", () => {
    const doc = Array.from({ length: 200 }, (_, i) => `## Hooks heading ${i}`).join("\n");
    const { text } = extractRelevantContent(doc, "hooks", 100);
    expect(text).toContain("Hooks heading");
  });
});
