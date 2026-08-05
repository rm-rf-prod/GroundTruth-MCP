import { describe, it, expect } from "vitest";
import {
  LIBRARY_REGISTRY,
  lookupById,
  lookupByAlias,
  fuzzySearch,
} from "./registry.js";

describe("fuzzySearch", () => {
  it("returns exact name match as first result", () => {
    const results = fuzzySearch("React");
    expect(results[0]?.name).toBe("React");
  });

  it("returns at most `limit` results", () => {
    const results = fuzzySearch("js", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array for nonsense query", () => {
    const results = fuzzySearch("zzzzzzzzzzzzzzzzz");
    expect(results).toHaveLength(0);
  });

  it("finds Vue.js by partial name 'vue'", () => {
    const results = fuzzySearch("vue");
    const ids = results.map((e) => e.id);
    expect(ids).toContain("vuejs/vue");
  });

  it("default limit is 10", () => {
    const results = fuzzySearch("js");
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("minScore=20 filters tag-only matches (score=10): fuzzySearch('bundler', 1, 20) returns empty", () => {
    // "bundler" exists only as a tag — no entry name, alias or npm package
    // contains it. ("build" no longer works as the probe: expo-build-properties
    // is a real library whose name contains it.)
    const results = fuzzySearch("bundler", 1, 20);
    expect(results).toHaveLength(0);
  });

  it("minScore=20 accepts alias-exact matches (score=90): fuzzySearch('vite', 1, 20) returns Vite entry", () => {
    const results = fuzzySearch("vite", 1, 20);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.id).toBe("vitejs/vite");
  });

  it("default fuzzySearch('vite') unchanged: still returns Vite entry", () => {
    const results = fuzzySearch("vite");
    const ids = results.map((e) => e.id);
    expect(ids).toContain("vitejs/vite");
  });
});
