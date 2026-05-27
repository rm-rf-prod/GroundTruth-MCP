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
      ];
      for (const q of samples) {
        const i = detectIntent({ query: q });
        expect(i.confidence).toBeGreaterThanOrEqual(0);
        expect(i.confidence).toBeLessThanOrEqual(1);
      }
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
