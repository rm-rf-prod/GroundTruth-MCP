import { describe, it, expect } from "vitest";
import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { exitCode, renderResult, renderToolHelp, renderTools } from "./render.js";
import { findCommand } from "./commands.js";

const ok: CallToolResult = { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], structuredContent: { n: 1 } };
const searchTool = {
  name: "gt_search",
  title: "Search Any Topic",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for. Long tail." },
      tokens: { type: "integer", default: 8000, minimum: 1000, maximum: 100000, description: "Budget." },
    },
    required: ["query"],
  },
} as Tool;

describe("exitCode", () => {
  it("is 0 for a normal result", () => expect(exitCode(ok)).toBe(0));
  it("is 2 for an SDK input validation error", () => {
    const r: CallToolResult = { content: [{ type: "text", text: "Input validation error: Invalid arguments for tool gt_compare: x" }], isError: true };
    expect(exitCode(r)).toBe(2);
  });
  it("is 1 for any other tool error", () => {
    expect(exitCode({ content: [{ type: "text", text: "Tool timed out" }], isError: true })).toBe(1);
  });
});

describe("renderResult", () => {
  it("joins text items with a blank line in plain mode", () => {
    expect(renderResult(ok, false)).toBe("a\n\nb\n");
  });

  it("replaces non-text content with a placeholder", () => {
    const r = { content: [{ type: "image", data: "x", mimeType: "image/png" }] } as CallToolResult;
    expect(renderResult(r, false)).toBe("[image content omitted; use --json]\n");
  });

  it("prints the whole CallToolResult in --json mode", () => {
    expect(JSON.parse(renderResult(ok, true))).toEqual(ok);
  });
});

describe("help and tool listing", () => {
  const cmd = findCommand("search");
  if (!cmd) throw new Error("search command missing");

  it("documents usage, positionals and every schema flag", () => {
    const help = renderToolHelp(cmd, searchTool);
    expect(help).toContain("usage: gt-mcp search <query...> [flags]");
    expect(help).toContain("Search Any Topic (gt_search)");
    expect(help).toMatch(/--tokens <integer>\s+Budget\. \(default 8000, 1000-100000\)/);
    expect(help).toMatch(/--query <string>\s+What to search for\. \(required\)/);
    expect(help).toContain("--json");
  });

  it("does not cut a flag description at an abbreviation", () => {
    const tool = { ...searchTool, inputSchema: { ...searchTool.inputSchema, properties: { query: { type: "string", description: "Specific subject, e.g. hooks. Second sentence." } } } } as Tool;
    expect(renderToolHelp(cmd, tool)).toMatch(/--query <string>\s+Specific subject, e\.g\. hooks\. \(required\)/);
  });

  it("lists tools with their command and positionals", () => {
    const out = renderTools([searchTool]);
    expect(out).toMatch(/search\s+gt_search\s+<query\.\.\.>\s+Search Any Topic/);
  });

  it("never emits ANSI escapes", () => {
    const all = renderToolHelp(cmd, searchTool) + renderTools([searchTool]) + renderResult(ok, false);
    expect(all).not.toContain("\x1b[");
  });
});
