import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { Tool } from "@modelcontextprotocol/server";
import type { Command } from "./commands.js";

/** A problem with how the command was invoked: exit code 2. */
export class UsageError extends Error {}

export interface ParsedInput {
  args: Record<string, unknown>;
  json: boolean;
  help: boolean;
}

export type SchemaProp = { type?: string; description?: string; default?: unknown; minimum?: number; maximum?: number };

export function schemaProps(tool: Tool): Record<string, SchemaProp> {
  return (tool.inputSchema.properties ?? {}) as Record<string, SchemaProp>;
}

export function flagName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function toNumber(raw: string, key: string, integer: boolean): number {
  const n = Number(raw);
  const ok = raw.trim() !== "" && (integer ? Number.isInteger(n) : Number.isFinite(n));
  if (!ok) throw new UsageError(`--${flagName(key)} expects ${integer ? "an integer" : "a number"}, got '${raw}'`);
  return n;
}

/**
 * Turn argv into tool arguments using the tool's own JSON Schema: one
 * --kebab-case flag per property, plus the command's positionals. '-' as a
 * string value reads stdin, once.
 */
export async function buildInput(
  cmd: Command,
  tool: Tool,
  argv: string[],
  stdin: () => Promise<string>,
): Promise<ParsedInput> {
  const props = schemaProps(tool);
  const options: ParseArgsOptionsConfig = { json: { type: "boolean" }, help: { type: "boolean", short: "h" } };
  for (const [key, p] of Object.entries(props)) {
    options[flagName(key)] = p.type === "boolean" ? { type: "boolean" } : { type: "string", multiple: p.type === "array" };
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, allowNegative: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (values["help"] === true) return { args: {}, json: false, help: true };

  let stdinUsed = false;
  const text = async (v: string): Promise<string> => {
    if (v !== "-") return v;
    if (stdinUsed) throw new UsageError("'-' (stdin) may be used once");
    stdinUsed = true;
    return (await stdin()).trimEnd();
  };

  const args: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(props)) {
    const raw = values[flagName(key)];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) args[key] = raw.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean);
    else if (typeof raw === "boolean") args[key] = raw;
    else if (p.type === "integer" || p.type === "number") args[key] = toNumber(raw, key, p.type === "integer");
    else args[key] = await text(raw);
  }

  const rest = [...positionals];
  for (const spec of cmd.positionals) {
    if (rest.length === 0) break;
    const many = spec.startsWith("...");
    const key = many ? spec.slice(3) : spec;
    if (key in args) throw new UsageError(`<${key}> given both as argument and as --${flagName(key)}`);
    const taken = many ? rest.splice(0) : rest.splice(0, 1);
    const type = props[key]?.type;
    if (type === "array") args[key] = taken;
    else if (type === "integer" || type === "number") args[key] = toNumber(taken.join(" "), key, type === "integer");
    else args[key] = await text(taken.join(" "));
  }
  if (rest.length > 0) throw new UsageError(`unexpected argument '${rest[0]}'`);

  for (const key of tool.inputSchema.required ?? []) {
    if (!(key in args)) throw new UsageError(`missing <${key}>; see 'gt-mcp ${cmd.name} --help'`);
  }
  return { args, json: values["json"] === true, help: false };
}
