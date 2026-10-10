import { describe, it, expect } from "vitest";
import { detectIntent } from "./intent-router.js";

const route = (query: string): { tool: string; args: Record<string, unknown> } => detectIntent({ query });
const topicOf = (query: string): string => String(route(query).args["topic"] ?? "");

// ACC-08: a docs-style route without a topic retrieves generic best practices
// instead of the thing the caller asked about.
describe("detectIntent keeps the subject as topic", () => {
  it("uses the rest of the query when no about/for marker names a topic", () => {
    const r = route("how do I clean up a subscription in React useEffect");
    expect(r.tool).toBe("gt_best_practices");
    expect(r.args["libraryId"]).toBe("facebook/react");
    expect(topicOf("how do I clean up a subscription in React useEffect")).toBe("clean up subscription useEffect");
  });

  it("drops the library name, hint phrase and ecosystem words from the topic", () => {
    expect(topicOf("react hooks best practices")).toBe("hooks");
    expect(topicOf("rust tokio spawn a task")).toBe("spawn task");
    expect(topicOf("requests session retries in python")).toBe("session retries");
  });

  it("gives multi-word library names their own route and topic", () => {
    expect(route("expo router dynamic routes").args).toEqual({ libraryId: "expo/expo-router", topic: "dynamic routes" });
    const r = route("tanstack query invalidateQueries after mutation");
    expect(r.args["libraryId"]).toBe("tanstack/query");
    expect(r.args["topic"]).toBe("invalidateQueries after mutation");
  });

  it("omits the topic when the query is only the library name", () => {
    expect(route("use gt for react").args).toEqual({ libraryId: "facebook/react" });
  });

  it("passes the subject as pattern for examples and topic for snippets", () => {
    expect(route("examples of zod discriminated unions").args).toEqual({ library: "zod", pattern: "discriminated unions" });
    expect(route("prisma transaction snippets").args).toEqual({ libraryId: "prisma/prisma", topic: "transaction" });
  });

  it("keeps css selector syntax in a compat feature", () => {
    const r = route("browser support for css :has()");
    expect(r.tool).toBe("gt_compat");
    expect(r.args["feature"]).toBe("css :has()");
  });
});

describe("detectIntent verb guards", () => {
  it("compares only when both sides are registry libraries", () => {
    const r = route("django select_related vs prefetch_related");
    expect(r.tool).toBe("gt_best_practices");
    expect(r.args["libraryId"]).toBe("django/django");
    expect(r.args["topic"]).toBe("select_related vs prefetch_related");
  });

  it("compares two libraries joined by and/with, not only vs/or", () => {
    expect(route("compare react and vue").args).toEqual({ libraries: ["react", "vue"] });
    expect(route("compare prisma and drizzle").args).toEqual({ libraries: ["prisma", "drizzle"] });
    expect(route("differences between vite and webpack").args).toEqual({ libraries: ["vite", "webpack"] });
    expect(route("compare vite with webpack").tool).toBe("gt_compare");
    expect(route("compare react hooks and vue composables").args["libraryId"]).toBe("facebook/react");
  });

  it("routes a migration only with a version", () => {
    expect(route("upgrade react").tool).toBe("gt_best_practices");
    expect(route("upgrade react to 19").tool).toBe("gt_migration");
  });

  it("matches hint words whole, not inside other words", () => {
    const drizzle = route("how to run drizzle migrations with drizzle-kit");
    expect(drizzle.tool).toBe("gt_best_practices");
    expect(drizzle.args["topic"]).toContain("migrations");
    expect(route("react canvas performance").tool).toBe("gt_best_practices");
  });

  it("still matches the inflected hint forms whole-word matching would drop", () => {
    expect(route("auditing my codebase").tool).toBe("gt_audit");
    expect(route("audits for this repo").tool).toBe("gt_audit");
    expect(route("react native samples").tool).toBe("gt_examples");
    expect(route("code samples for fastapi").tool).toBe("gt_examples");
    expect(route("changelogs for vite").tool).toBe("gt_changelog");
    expect(route("upgrades for next.js 15").tool).toBe("gt_migration");
    expect(route("drizzle migrations").tool).toBe("gt_best_practices");
  });
});

describe("detectIntent topic length", () => {
  // The dispatch input allows 2000 chars; the target tools cap topic/pattern at 300.
  it("keeps a topic taken from a long query within the target schema", () => {
    const filler = " how do the hooks behave across renders when state changes".repeat(40).slice(0, 1950);
    for (const query of [`react best practices${filler}`, `react examples${filler}`, `react snippets${filler}`]) {
      const r = route(query);
      const subject = String(r.args["topic"] ?? r.args["pattern"] ?? "");
      expect(subject.length).toBeGreaterThan(0);
      expect(subject.length).toBeLessThanOrEqual(300);
    }
  });
});
