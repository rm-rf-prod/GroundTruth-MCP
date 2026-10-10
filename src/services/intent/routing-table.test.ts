import { describe, it, expect } from "vitest";
import { renderRoutingTable } from "./routing-table.js";

const rows = renderRoutingTable().split("\n").filter((l) => l.startsWith("| `"));

describe("renderRoutingTable", () => {
  it("sends a named library straight to gt_best_practices, resolving only when unresolved", () => {
    const row = rows.find((r) => r.includes("check docs for X"));
    const toolCell = row?.split("|")[2] ?? "";
    expect(toolCell.trim().startsWith("`gt_best_practices(")).toBe(true);
    expect(toolCell).not.toContain("gt_resolve_library");
    expect(row).toContain("gt_resolve_library");
    expect(row).toMatch(/unresolved/i);
  });

  it("uses a current version pair in the migration example", () => {
    const row = rows.find((r) => r.includes("gt_migration"));
    expect(row).toContain("from 15 to 16");
    expect(row).not.toContain("14 to 15");
  });
});
