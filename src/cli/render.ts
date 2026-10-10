import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { flagName, schemaProps, type SchemaProp } from "./args.js";
import { findCommand, type Command } from "./commands.js";

// Prefix the SDK puts on schema rejections it wraps into an isError result.
const INVALID_INPUT = /^(Input validation error|Invalid arguments for tool)\b/;

function textOf(result: CallToolResult): string {
  return result.content
    .map((item) => (item.type === "text" ? item.text : `[${item.type} content omitted; use --json]`))
    .join("\n\n");
}

/** 0 success (honest misses included), 2 rejected input, 1 any other tool error. */
export function exitCode(result: CallToolResult): 0 | 1 | 2 {
  if (result.isError !== true) return 0;
  return INVALID_INPUT.test(textOf(result)) ? 2 : 1;
}

/** --json prints the whole CallToolResult: structuredContent alone drops the docs text. */
export function renderResult(result: CallToolResult, json: boolean): string {
  return json ? `${JSON.stringify(result, null, 2)}\n` : `${textOf(result)}\n`;
}

function usageOf(cmd: Command, tool: Tool): string {
  const required = new Set(tool.inputSchema.required ?? []);
  return cmd.positionals
    .map((spec) => {
      const many = spec.startsWith("...");
      const key = many ? spec.slice(3) : spec;
      const label = `${key}${many ? "..." : ""}`;
      return required.has(key) ? `<${label}>` : `[${label}]`;
    })
    .join(" ");
}

// Abbreviations like "e.g." and "i.e." end with a period but do not end the sentence.
function firstSentence(text: string | undefined): string {
  return (text ?? "").split(/(?<!\b(?:e\.g|i\.e|etc|vs)\.)(?<=\.)\s/)[0]?.trim() ?? "";
}

function flagLine(key: string, p: SchemaProp, required: boolean): [string, string] {
  const flag = p.type === "boolean" ? `--[no-]${flagName(key)}` : `--${flagName(key)} <${p.type ?? "string"}>`;
  const notes: string[] = [];
  if (required) notes.push("required");
  if (p.default !== undefined) notes.push(`default ${JSON.stringify(p.default)}`);
  if (p.minimum !== undefined || p.maximum !== undefined) notes.push(`${p.minimum ?? ""}-${p.maximum ?? ""}`);
  if (p.type === "array") notes.push("repeat or comma-separate");
  const desc = firstSentence(p.description);
  return [flag, [desc, notes.length ? `(${notes.join(", ")})` : ""].filter(Boolean).join(" ")];
}

function columns(rows: string[][]): string {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i] ?? 0) : cell)).join("  ").trimEnd()).join("\n");
}

export function renderToolHelp(cmd: Command, tool: Tool): string {
  const required = new Set(tool.inputSchema.required ?? []);
  const rows = Object.entries(schemaProps(tool)).map(([k, p]) => flagLine(k, p, required.has(k)));
  rows.push(["--json", "Print the full CallToolResult as JSON"], ["--help, -h", "Show this help"]);
  const aliases = cmd.aliases.length ? `\nAliases: ${cmd.aliases.join(", ")}, ${cmd.tool}` : `\nAlias: ${cmd.tool}`;
  return [
    `usage: gt-mcp ${cmd.name} ${usageOf(cmd, tool)} [flags]`.replace(/ {2,}/g, " "),
    "",
    `${tool.title ?? tool.name} (${tool.name})${aliases}`,
    "",
    "Flags:",
    columns(rows).replace(/^/gm, "  "),
    "",
    "A '-' value reads stdin. Exit codes: 0 ok, 1 tool error, 2 usage error.",
    "",
  ].join("\n");
}

export function renderTools(tools: Tool[]): string {
  const rows = tools.map((t) => {
    const cmd = findCommand(t.name);
    return [cmd?.name ?? "-", t.name, cmd ? usageOf(cmd, t) : "", t.title ?? ""];
  });
  return `${columns([["COMMAND", "TOOL", "ARGUMENTS", "TITLE"], ...rows])}\n`;
}
