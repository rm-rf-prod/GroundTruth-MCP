import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAllTools } from "../server/register-tools.js";

const tools = new Map<string, { description: string; inputSchema: z.ZodObject }>();
registerAllTools({
  registerTool(name: string, config: { description: string; inputSchema: z.ZodObject }) {
    tools.set(name, config);
  },
} as unknown as McpServer);

const description = (name: string): string => tools.get(name)?.description ?? "";

function paramDescriptions(): string[] {
  const out: string[] = [];
  for (const { inputSchema } of tools.values()) {
    for (const field of Object.values(inputSchema.shape as Record<string, z.ZodType>)) {
      if (field.description) out.push(field.description);
    }
  }
  return out;
}

describe("tool descriptions stay short and precise", () => {
  it("keeps all 14 descriptions within a tight budget", () => {
    expect(tools.size).toBe(14);
    const total = [...tools.values()].reduce((n, t) => n + t.description.length, 0);
    expect(total).toBeLessThanOrEqual(2_800);
    for (const [name, t] of tools) expect(t.description.length, name).toBeLessThanOrEqual(360);
  });

  it("keeps parameter descriptions within budget", () => {
    const total = paramDescriptions().reduce((n, d) => n + d.length, 0);
    expect(total).toBeLessThanOrEqual(1_200);
  });

  it("drops copied, contradictory and repeated instructions", () => {
    const banned = [/Context7/, /MUST call/, /more than 3 times/, /\/org\/project/, /request clarification/i,
      /gt_resolve_library first/, /PROPRIETARY DATA NOTICE/];
    for (const [name, t] of tools) {
      for (const re of banned) expect(t.description, `${name} ${re}`).not.toMatch(re);
    }
    for (const d of paramDescriptions()) expect(d).not.toMatch(/from gt_resolve_library/);
  });

  it("keeps one short license line on the two registry lookups", () => {
    expect(description("gt_resolve_library")).toMatch(/Elastic-2\.0/);
    expect(description("gt_batch_resolve")).toMatch(/Elastic-2\.0/);
  });

  it("keeps the sibling boundaries", () => {
    const pairs: Array<[string, string[]]> = [
      ["gt_get_docs", ["gt_best_practices", "gt_snippets"]],
      ["gt_snippets", ["gt_get_docs", "gt_examples"]],
      ["gt_examples", ["gt_snippets"]],
      ["gt_changelog", ["gt_migration"]],
      ["gt_migration", ["gt_changelog"]],
      ["gt_auto_scan", ["gt_audit"]],
      ["gt_audit", ["gt_auto_scan"]],
      ["gt_resolve_library", ["gt_batch_resolve"]],
      ["gt_batch_resolve", ["gt_resolve_library", "gt_auto_scan"]],
      ["gt_search", ["gt_best_practices", "gt_get_docs", "gt_compat", "gt_examples"]],
      ["gt_compare", ["gt_get_docs"]],
    ];
    for (const [tool, siblings] of pairs) {
      for (const s of siblings) expect(description(tool), `${tool} -> ${s}`).toContain(s);
    }
  });

  it("tells the model the docs tools accept plain library names", () => {
    expect(description("gt_get_docs")).toMatch(/plain name/);
    expect(description("gt_best_practices")).toMatch(/plain name/);
    expect(description("gt_resolve_library")).toMatch(/plain names/);
  });

  it("uses a current migration example", () => {
    expect(description("gt_dispatch")).toContain("15 to 16");
    expect(JSON.stringify(paramDescriptions())).not.toContain("14 to 15");
  });
});
