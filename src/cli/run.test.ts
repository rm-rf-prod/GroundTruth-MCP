import { describe, it, expect } from "vitest";
import { runCli } from "./run.js";
import { TOOL_COUNT } from "../constants.js";

// Real server, in-process, offline commands only (registry lookups and intent routing).
describe("runCli end-to-end", () => {
  it("resolve react answers from the registry with exit 0", async () => {
    const r = await runCli(["resolve", "react"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("facebook/react");
    expect(r.err).toBe("");
  });

  it("dispatch --json prints the full CallToolResult with the routed tool", async () => {
    const r = await runCli(["dispatch", "migrate", "next", "from", "14", "to", "15", "--json"]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.out) as { content: unknown[]; structuredContent: { tool: string } };
    expect(result.structuredContent.tool).toBe("gt_migration");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("accepts the tool name and aliases as the command", async () => {
    expect((await runCli(["gt_batch_resolve", "react", "vue"])).code).toBe(0);
    expect((await runCli(["ask", "use", "gt", "for", "react"])).code).toBe(0);
  });

  it("maps a schema rejection from the server to exit 2", async () => {
    const r = await runCli(["compare", "prisma"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^gt-mcp: Input validation error/);
    expect(r.out).toBe("");
  });

  it("reports usage problems with exit 2 and no stdout", async () => {
    for (const argv of [["frobnicate"], ["docs"], ["docs", "react", "--tokens", "abc"], ["tools", "--bogus"]]) {
      const r = await runCli(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toMatch(/^gt-mcp: /);
    }
  });

  describe("call", () => {
    it("runs a tool from JSON arguments", async () => {
      const r = await runCli(["call", "gt_resolve_library", '{"libraryName":"react"}', "--json"]);
      expect(r.code).toBe(0);
      expect(JSON.stringify(JSON.parse(r.out))).toContain("facebook/react");
    });

    it("reads JSON arguments from stdin with '-'", async () => {
      const r = await runCli(["call", "batch", "-"], { stdin: async () => '{"libraryNames":["react"]}' });
      expect(r.code).toBe(0);
    });

    it.each([
      [["call", "gt_nope", "{}"], /Tool gt_nope not found/],
      [["call", "gt_batch_resolve", "{bad"], /JSON/],
      [["call", "gt_batch_resolve", "[1]"], /JSON object/],
      [["call"], /usage: gt-mcp call/],
    ])("%j exits 2", async (argv, message) => {
      const r = await runCli(argv);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(message);
    });

    it("keeps --json errors on stdout in CallToolResult shape", async () => {
      const r = await runCli(["call", "gt_nope", "{}", "--json"]);
      expect(r.code).toBe(2);
      expect(JSON.parse(r.out)).toMatchObject({ isError: true, content: [{ type: "text" }] });
    });
  });

  describe("tools and help", () => {
    it("tools --json lists every tool", async () => {
      const r = await runCli(["tools", "--json"]);
      expect((JSON.parse(r.out) as { tools: unknown[] }).tools).toHaveLength(TOOL_COUNT);
    });

    it("tools prints a table", async () => {
      expect((await runCli(["tools"])).out).toMatch(/^COMMAND\s+TOOL/);
    });

    it("<command> --help and help <command> show the schema flags", async () => {
      for (const argv of [["search", "--help"], ["help", "search"]]) {
        const r = await runCli(argv);
        expect(r.code).toBe(0);
        expect(r.out).toContain("--tokens <integer>");
      }
    });

    it("help alone prints the top-level help with the command list", async () => {
      const r = await runCli(["help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Commands:");
      expect(r.out).toContain("best-practices");
    });
  });
});
