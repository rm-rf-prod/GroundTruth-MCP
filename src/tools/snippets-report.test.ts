import { describe, it, expect } from "vitest";
import { renderSnippetResult } from "./snippets-report.js";

describe("renderSnippetResult", () => {
  it("keeps the header rule and the first snippet heading on separate lines", () => {
    const { content } = renderSnippetResult({
      snippets: [{ id: "a", title: "Define a schema", description: "", language: "ts", code: "z.object({})", source: "https://zod.dev", score: 1 }],
      library: "colinhacks/zod",
      displayName: "Zod",
      topic: "schema",
      version: undefined,
      language: undefined,
      sourceUrl: "https://zod.dev/llms.txt",
      builtAt: "2026-10-10",
      fromCache: false,
    } as Parameters<typeof renderSnippetResult>[0]);
    expect(content[0]!.text).not.toMatch(/---[^\n-]/);
    expect(content[0]!.text).toContain("\n---\n\n");
  });
});
