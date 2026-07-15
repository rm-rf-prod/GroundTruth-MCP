import { describe, it, expect } from "vitest";
import { detectIntent, renderRoutingTable } from "./intent-router.js";

describe("intent-router", () => {
  describe("detectIntent", () => {
    it("routes empty / 'use gt' to gt_auto_scan", () => {
      expect(detectIntent({ query: "use gt" }).tool).toBe("gt_auto_scan");
      expect(detectIntent({ query: "use gt mcp" }).tool).toBe("gt_auto_scan");
      expect(detectIntent({ query: "groundtruth this project" }).tool).toBe("gt_auto_scan");
    });

    it("routes URL pasted to gt_get_docs", () => {
      const intent = detectIntent({ query: "https://nextjs.org/docs/app/routing" });
      expect(intent.tool).toBe("gt_get_docs");
      expect(intent.args["libraryId"]).toBe("https://nextjs.org/docs/app/routing");
      expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("routes 'use gt for react' to gt_best_practices with library id", () => {
      const intent = detectIntent({ query: "use gt for react" });
      expect(intent.tool).toBe("gt_best_practices");
      expect(intent.args["libraryId"]).toBe("facebook/react");
    });

    it("routes 'next.js routing docs' to gt_get_docs", () => {
      const intent = detectIntent({ query: "docs for next.js about routing" });
      expect(intent.tool).toBe("gt_get_docs");
      expect(intent.args["libraryId"]).toBe("vercel/next.js");
      expect(intent.args["topic"]).toBe("routing");
    });

    it("routes 'find issues' to gt_audit", () => {
      const intent = detectIntent({ query: "find all the issues in this codebase" });
      expect(intent.tool).toBe("gt_audit");
      expect(intent.args["categories"]).toEqual(["all"]);
    });

    it("routes 'audit my project' with provided projectPath", () => {
      const intent = detectIntent({ query: "run an audit", projectPath: "/tmp/proj" });
      expect(intent.tool).toBe("gt_audit");
      expect(intent.args["projectPath"]).toBe("/tmp/proj");
    });

    it("routes 'migrate next from 14 to 15' with versions extracted", () => {
      const intent = detectIntent({ query: "help me migrate next from 14 to 15" });
      expect(intent.tool).toBe("gt_migration");
      expect(intent.args["libraryId"]).toBe("vercel/next.js");
      expect(intent.args["fromVersion"]).toBe("14");
      expect(intent.args["toVersion"]).toBe("15");
    });

    it("routes 'changelog react' to gt_changelog", () => {
      const intent = detectIntent({ query: "what's new in react" });
      expect(intent.tool).toBe("gt_changelog");
      expect(intent.args["libraryId"]).toBe("facebook/react");
    });

    it("routes 'prisma vs drizzle' to gt_compare with both libs", () => {
      const intent = detectIntent({ query: "compare prisma vs drizzle" });
      expect(intent.tool).toBe("gt_compare");
      const libs = intent.args["libraries"];
      expect(Array.isArray(libs)).toBe(true);
      const list = libs as string[];
      expect(list).toContain("prisma");
      expect(list).toContain("drizzle");
    });

    it("routes 'browser support for container queries' to gt_compat", () => {
      const intent = detectIntent({ query: "browser support for container queries" });
      expect(intent.tool).toBe("gt_compat");
      expect(String(intent.args["feature"] ?? "")).toContain("container queries");
    });

    it("routes 'examples of trpc' to gt_examples", () => {
      const intent = detectIntent({ query: "show me examples of trpc" });
      expect(intent.tool).toBe("gt_examples");
      expect(intent.args["library"]).toBe("trpc");
    });

    it("falls back to gt_search for unknown topic", () => {
      const intent = detectIntent({ query: "explain quantum computing basics" });
      expect(intent.tool).toBe("gt_search");
      expect(String(intent.args["query"] ?? "")).toContain("quantum");
    });

    it("never returns confidence > 1 or < 0", () => {
      const samples = [
        "use gt",
        "use gt for nextjs",
        "https://docs.example.com",
        "find bugs",
        "migrate next from 14 to 15",
        "compare zod vs valibot",
        "what is OWASP",
        "batch lookup react next prisma",
        "resolve multiple libraries",
      ];
      for (const q of samples) {
        const i = detectIntent({ query: q });
        expect(i.confidence).toBeGreaterThanOrEqual(0);
        expect(i.confidence).toBeLessThanOrEqual(1);
      }
    });

    // CORR-006: generic build-question must not misroute to a build-tool library
    it("does not route 'how to build a rest api' to gt_best_practices for a build-tool library", () => {
      const intent = detectIntent({ query: "how to build a rest api" });
      expect(intent.tool).toBe("gt_search");
    });

    // CORR-007: batch with parseable library names routes to gt_batch_resolve
    it("routes 'batch lookup react next prisma' to gt_batch_resolve with libraryNames", () => {
      const intent = detectIntent({ query: "batch lookup react next prisma" });
      expect(intent.tool).toBe("gt_batch_resolve");
      const names = intent.args["libraryNames"];
      expect(Array.isArray(names)).toBe(true);
      const list = names as string[];
      expect(list).toContain("react");
      expect(list).toContain("next");
      expect(list).toContain("prisma");
    });

    // CORR-007: batch with no resolvable library names falls back to gt_search
    it("routes 'resolve multiple libraries' to gt_search when no library names are parseable", () => {
      const intent = detectIntent({ query: "resolve multiple libraries" });
      expect(intent.tool).toBe("gt_search");
    });
  });

  describe("renderRoutingTable", () => {
    it("returns a non-empty markdown table", () => {
      const table = renderRoutingTable();
      expect(table.length).toBeGreaterThan(200);
      expect(table).toContain("| User input pattern");
      expect(table).toContain("gt_auto_scan");
      expect(table).toContain("gt_best_practices");
      expect(table).toContain("gt_audit");
    });
  });
});

describe("compat routing — natural browser-support phrasing", () => {
  it("routes 'does safari support container queries' to gt_compat with a clean feature", () => {
    const intent = detectIntent({ query: "does safari support container queries" });
    expect(intent.tool).toBe("gt_compat");
    const feature = String(intent.args["feature"] ?? "");
    expect(feature).toContain("container queries");
    expect(feature).not.toMatch(/safari|does|support/i);
  });

  it("routes 'can i use view transitions' to gt_compat", () => {
    const intent = detectIntent({ query: "can i use view transitions" });
    expect(intent.tool).toBe("gt_compat");
  });
});

// ── required-arg fallback guards ──────────────────────────────────────────────

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
