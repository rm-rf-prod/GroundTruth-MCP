import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "./server-instructions.js";

describe("buildServerInstructions", () => {
  it("includes '# Tools (14)' heading when called with 14", () => {
    const result = buildServerInstructions(14);
    expect(result).toContain("# Tools (14)");
  });

  it("does not contain the unexpanded literal ${TOOL_COUNT}", () => {
    const result = buildServerInstructions(14);
    expect(result).not.toContain("${TOOL_COUNT}");
  });

  it("includes gt_dispatch", () => {
    expect(buildServerInstructions(14)).toContain("gt_dispatch");
  });

  it("includes gt_resolve_library", () => {
    expect(buildServerInstructions(14)).toContain("gt_resolve_library");
  });

  it("includes gt_get_docs", () => {
    expect(buildServerInstructions(14)).toContain("gt_get_docs");
  });

  it("includes gt_best_practices", () => {
    expect(buildServerInstructions(14)).toContain("gt_best_practices");
  });

  it("includes gt_auto_scan", () => {
    expect(buildServerInstructions(14)).toContain("gt_auto_scan");
  });

  it("includes gt_search", () => {
    expect(buildServerInstructions(14)).toContain("gt_search");
  });

  it("includes gt_audit", () => {
    expect(buildServerInstructions(14)).toContain("gt_audit");
  });

  it("includes gt_changelog", () => {
    expect(buildServerInstructions(14)).toContain("gt_changelog");
  });

  it("includes gt_compat", () => {
    expect(buildServerInstructions(14)).toContain("gt_compat");
  });

  it("includes gt_compare", () => {
    expect(buildServerInstructions(14)).toContain("gt_compare");
  });

  it("includes gt_examples", () => {
    expect(buildServerInstructions(14)).toContain("gt_examples");
  });

  it("includes gt_migration", () => {
    expect(buildServerInstructions(14)).toContain("gt_migration");
  });

  it("includes gt_batch_resolve", () => {
    expect(buildServerInstructions(14)).toContain("gt_batch_resolve");
  });

  it("includes gt_snippets", () => {
    expect(buildServerInstructions(14)).toContain("gt_snippets");
  });

  it("interpolates a different toolCount correctly", () => {
    const result = buildServerInstructions(7);
    expect(result).toContain("# Tools (7)");
    expect(result).not.toContain("# Tools (14)");
  });
});
