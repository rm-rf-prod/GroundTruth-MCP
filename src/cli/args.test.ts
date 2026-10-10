import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/server";
import { buildInput, flagName, UsageError } from "./args.js";
import { findCommand, type Command } from "./commands.js";

const tool = (properties: Record<string, unknown>, required: string[] = []): Tool =>
  ({ name: "t", inputSchema: { type: "object", properties, required } }) as Tool;

const docsTool = tool(
  { libraryId: { type: "string" }, topic: { type: "string" }, tokens: { type: "integer" }, projectPath: { type: "string" } },
  ["libraryId"],
);
const compareTool = tool({ libraries: { type: "array", items: { type: "string" } }, criteria: { type: "string" } }, ["libraries"]);
const auditTool = tool({ projectPath: { type: "string" }, categories: { type: "array" }, maxFiles: { type: "integer" } });
const snippetsTool = tool({ libraryId: { type: "string" }, refresh: { type: "boolean" } }, ["libraryId"]);

const cmd = (name: string): Command => {
  const c = findCommand(name);
  if (!c) throw new Error(name);
  return c;
};
const noStdin = async (): Promise<string> => { throw new Error("stdin must not be read"); };

describe("flagName", () => {
  it("kebab-cases camelCase keys", () => {
    expect(flagName("tokensPerLib")).toBe("tokens-per-lib");
    expect(flagName("query")).toBe("query");
  });
});

describe("buildInput", () => {
  it("fills positionals in order and joins a rest positional into one string", async () => {
    const r = await buildInput(cmd("docs"), docsTool, ["react", "use", "effect", "--tokens", "500"], noStdin);
    expect(r).toEqual({ args: { libraryId: "react", topic: "use effect", tokens: 500 }, json: false, help: false });
  });

  it("keeps a rest positional as a list for array fields", async () => {
    const r = await buildInput(cmd("compare"), compareTool, ["prisma", "drizzle", "--criteria", "speed"], noStdin);
    expect(r.args).toEqual({ libraries: ["prisma", "drizzle"], criteria: "speed" });
  });

  it("maps kebab-case flags and splits repeated or comma-separated arrays", async () => {
    const r = await buildInput(cmd("audit"), auditTool,
      ["--categories", "security,react", "--categories", "perf", "--max-files", "3", "/p"], noStdin);
    expect(r.args).toEqual({ categories: ["security", "react", "perf"], maxFiles: 3, projectPath: "/p" });
  });

  it("supports --flag and --no-flag for booleans", async () => {
    expect((await buildInput(cmd("snippets"), snippetsTool, ["x", "--refresh"], noStdin)).args.refresh).toBe(true);
    expect((await buildInput(cmd("snippets"), snippetsTool, ["x", "--no-refresh"], noStdin)).args.refresh).toBe(false);
  });

  it("sets json for --json", async () => {
    expect((await buildInput(cmd("docs"), docsTool, ["react", "--json"], noStdin)).json).toBe(true);
  });

  it("checks --help before required fields", async () => {
    const r = await buildInput(cmd("docs"), docsTool, ["--help"], noStdin);
    expect(r.help).toBe(true);
  });

  it.each([
    [["--tokens", "abc", "react"], /--tokens expects an integer/],
    [[], /missing <libraryId>/],
    [["react", "--library-id", "vue"], /given both/],
    [["react", "--bogus"], /bogus/],
    [["react", "--tokens"], /tokens/],
  ])("rejects %j as a usage error", async (argv, message) => {
    const err = await buildInput(cmd("docs"), docsTool, argv, noStdin).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toMatch(message);
  });

  it("rejects a surplus positional", async () => {
    const err = await buildInput(cmd("audit"), auditTool, ["/a", "/b"], noStdin).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toMatch(/unexpected argument '\/b'/);
  });

  it("reads '-' from stdin, trimmed, at most once", async () => {
    const stdin = async (): Promise<string> => "hooks rules\n";
    const r = await buildInput(cmd("docs"), docsTool, ["react", "-"], stdin);
    expect(r.args.topic).toBe("hooks rules");
    const err = await buildInput(cmd("docs"), docsTool, ["-", "--topic", "-"], stdin).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toMatch(/once/);
  });
});
