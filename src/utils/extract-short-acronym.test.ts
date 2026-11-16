import { describe, it, expect } from "vitest";
import { extractRelevantContent } from "./extract.js";

describe("extractRelevantContent short acronyms", () => {
  it("finds the section for a bare 2-char topic", () => {
    const filler = (n: number) => `## Topic ${n}\n\n${"Unrelated filler words here. ".repeat(40)}\n\n`;
    const doc = "# Docs\n\nIntro text.\n\n" + [1, 2, 3, 4, 5].map(filler).join("") +
      "## D1 database\n\nUse D1 bindings. D1 query D1.\n\n" + [6, 7, 8].map(filler).join("");
    expect(extractRelevantContent(doc, "D1", 400).text).toContain("D1 bindings");
  });
});
