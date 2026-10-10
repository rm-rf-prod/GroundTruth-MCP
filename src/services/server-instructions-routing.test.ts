import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "./server-instructions.js";

// The docs tools resolve plain names themselves, so a named library must not
// cost a gt_resolve_library round trip first.
describe("server instructions routing for a named library", () => {
  const text = buildServerInstructions(14);
  const row = text.split("\n").find((l) => l.startsWith("| a library name"));

  it("routes a named library straight to gt_best_practices with the name as libraryId", () => {
    expect(row).toBeDefined();
    expect(row).toMatch(/^\| a library name[^|]*\| gt_best_practices\(\{libraryId:"<name>"/);
  });

  it("keeps gt_resolve_library only as the unresolved fallback", () => {
    expect(text).not.toContain("gt_resolve_library -> gt_best_practices");
    expect(row).toContain("gt_resolve_library only if unresolved");
  });

  it("does not tell the model to resolve before calling a docs tool", () => {
    expect(text).not.toMatch(/resolve it, never ask/);
  });
});
