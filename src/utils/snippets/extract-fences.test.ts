import { describe, it, expect } from "vitest";
import { extractSnippets } from "./extract.js";

const doc = [
  "# Guide", "", "Intro prose that is long enough for the extractor to take it.", "",
  '```js title="a.js"', "const first = require('first-module');", "```", "",
  "More prose between.", "",
  "```ts", "const second: number = 2 + 2 + 2 + 2;", "```", "",
  "- list item", "", "  ```js", "  const third = 'third-in-list';", "  ```", "",
].join("\n");

describe("extractSnippets fences", () => {
  it("handles info strings and indented fences without inverting parity", () => {
    const s = extractSnippets(doc, "lib", "u");
    expect(s).toHaveLength(3);
    expect(s[0]!.language).toBe("javascript");
    expect(s[0]!.code).not.toContain("prose");
    expect(s[2]!.code).toContain("third-in-list");
  });
});
