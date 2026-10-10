import { parseArgs } from "node:util";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { buildInput, UsageError } from "./args.js";
import { findCommand, META } from "./commands.js";
import { exitCode, renderResult, renderToolHelp, renderTools } from "./render.js";
import { openSession, RpcError, type Session } from "./session.js";
import { flushDiskWrites } from "./flush.js";
import { helpText } from "../server/cli.js";

export interface CliResult {
  code: number;
  out: string;
  err: string;
}

export interface CliIO {
  stdin: () => Promise<string>;
}

async function readProcessStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new UsageError("'-' reads stdin, but stdin is a terminal");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const ok = (out: string): CliResult => ({ code: 0, out, err: "" });

async function invoke(session: Session, name: string, args: Record<string, unknown>, json: boolean): Promise<CliResult> {
  let result: CallToolResult;
  let code: number;
  try {
    result = await session.call(name, args);
    code = exitCode(result);
  } catch (e) {
    if (!(e instanceof RpcError)) throw e;
    result = { content: [{ type: "text", text: e.message }], isError: true };
    code = e.code === -32602 ? 2 : 1;
  }
  if (json || code === 0) return { code, out: renderResult(result, json), err: "" };
  return { code, out: "", err: `gt-mcp: ${renderResult(result, false)}` };
}

async function call(session: Session, argv: string[], io: CliIO): Promise<CliResult> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: "boolean" } }, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const [name, payload = "{}", extra] = parsed.positionals;
  if (name === undefined || extra !== undefined) throw new UsageError("usage: gt-mcp call <tool> [<json>|-] [--json]");
  let args: unknown;
  try {
    args = JSON.parse(payload === "-" ? await io.stdin() : payload);
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`arguments are not valid JSON: ${(e as Error).message}`);
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new UsageError("arguments must be a JSON object");
  }
  const tool = findCommand(name)?.tool ?? name; // unknown names reach the server: -32602, exit 2
  return invoke(session, tool, args as Record<string, unknown>, parsed.values.json === true);
}

async function dispatch(session: Session, word: string, rest: string[], io: CliIO): Promise<CliResult> {
  if (word === "call") return call(session, rest, io);
  if (word === "tools") {
    let json;
    try {
      json = parseArgs({ args: rest, options: { json: { type: "boolean" } }, strict: true }).values.json === true;
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    return ok(json ? `${JSON.stringify({ tools: session.tools }, null, 2)}\n` : renderTools(session.tools));
  }
  const cmd = findCommand(word);
  if (!cmd) throw new UsageError(`unknown command '${word}'; run 'gt-mcp --help'`);
  const tool = session.tools.find((t) => t.name === cmd.tool);
  if (!tool) throw new Error(`tool ${cmd.tool} is not registered`);
  const input = await buildInput(cmd, tool, rest, io.stdin);
  if (input.help) return ok(renderToolHelp(cmd, tool));
  return invoke(session, cmd.tool, input.args, input.json);
}

/** Run one CLI command. Never exits the process, so it stays testable. */
export async function runCli(argv: string[], io: CliIO = { stdin: readProcessStdin }): Promise<CliResult> {
  const [word = "help", ...rest] = argv;
  try {
    if (word === "help") {
      const topic = rest[0];
      return topic === undefined || META.has(topic) ? ok(helpText()) : runCli([topic, "--help"], io);
    }
    if (!META.has(word) && !findCommand(word)) throw new UsageError(`unknown command '${word}'; run 'gt-mcp --help'`);
    const session = await openSession();
    try {
      return await dispatch(session, word, rest, io);
    } finally {
      await session.close();
      await flushDiskWrites();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { code: e instanceof UsageError ? 2 : 1, out: "", err: `gt-mcp: ${message}\n` };
  }
}
