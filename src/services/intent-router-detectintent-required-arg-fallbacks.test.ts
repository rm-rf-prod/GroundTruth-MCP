import { describe, it, expect } from "vitest";
import { detectIntent, renderRoutingTable } from "./intent-router.js";

describe("detectIntent required-arg fallbacks", () => {
  it("falls back to gt_search when a migration verb has no parseable library", () => {
    const intent = detectIntent({ query: "how do I migrate my project safely" });
    expect(intent.tool).toBe("gt_search");
    expect(intent.args["query"]).toBeTruthy();
  });

  it("falls back to gt_search when a compare verb lacks two library names", () => {
    const intent = detectIntent({ query: "compare frameworks" });
    expect(intent.tool).toBe("gt_search");
  });

  it("falls back to gt_search when a changelog verb has no library", () => {
    const intent = detectIntent({ query: "what changed in the latest release" });
    expect(intent.tool).toBe("gt_search");
  });

  it("never recommends a tool whose required identifier is missing", () => {
    const queries = [
      "show me example usage",
      "best practices please",
      "upgrade guide",
      "get docs",
    ];
    for (const query of queries) {
      const intent = detectIntent({ query });
      if (["gt_migration", "gt_changelog", "gt_get_docs", "gt_best_practices", "gt_examples", "gt_snippets"].includes(intent.tool)) {
        expect(intent.args["libraryId"] ?? intent.args["library"]).toBeTruthy();
      }
      if (intent.tool === "gt_compare") {
        expect((intent.args["libraries"] as string[]).length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
