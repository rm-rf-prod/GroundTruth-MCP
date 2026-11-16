import { describe, it, expect, vi } from "vitest";

const snip = (language: string, n: number) => ({
  id: `${language}${n}`, library: "react", title: "hooks", description: "d", code: `code ${language} ${n} hooks`,
  language, source: "u", score: 0,
});
vi.mock("../services/snippets/build-index.js", () => ({
  buildIndex: vi.fn(async () => ({
    library: "react", version: null, sourceUrl: "https://react.dev", builtAt: "",
    snippets: [snip("python", 1), snip("typescript", 2)],
  })),
}));

import { docsFallbackResponse } from "./examples-fallback.js";

describe("docsFallbackResponse language", () => {
  it("filters snippets by the requested language", async () => {
    const r = await docsFallbackResponse({ library: "react", pattern: "hooks", language: "python", maxResults: 5, reason: "x" });
    const text = r.content[0]!.text;
    expect(text).toContain("code python 1");
    expect(text).not.toContain("code typescript 2");
  });
});
