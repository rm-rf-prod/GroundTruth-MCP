// Plain data with no imports: the bootstrap loads this on every start, so
// routing and the top-level --help never pay for the tool modules.

export interface Command {
  name: string;
  tool: string;
  aliases: readonly string[];
  /** Input keys filled from bare words, in order. A leading "..." takes all remaining words. */
  positionals: readonly string[];
}

export const COMMANDS: readonly Command[] = [
  { name: "dispatch", tool: "gt_dispatch", aliases: ["ask"], positionals: ["...query"] },
  { name: "resolve", tool: "gt_resolve_library", aliases: [], positionals: ["libraryName", "...query"] },
  { name: "docs", tool: "gt_get_docs", aliases: ["get-docs"], positionals: ["libraryId", "...topic"] },
  { name: "best-practices", tool: "gt_best_practices", aliases: ["bp"], positionals: ["libraryId", "...topic"] },
  { name: "scan", tool: "gt_auto_scan", aliases: ["auto-scan"], positionals: ["projectPath"] },
  { name: "search", tool: "gt_search", aliases: [], positionals: ["...query"] },
  { name: "audit", tool: "gt_audit", aliases: [], positionals: ["projectPath"] },
  { name: "changelog", tool: "gt_changelog", aliases: [], positionals: ["libraryId", "version"] },
  { name: "compat", tool: "gt_compat", aliases: [], positionals: ["...feature"] },
  { name: "compare", tool: "gt_compare", aliases: [], positionals: ["...libraries"] },
  { name: "examples", tool: "gt_examples", aliases: [], positionals: ["library", "...pattern"] },
  { name: "migrate", tool: "gt_migration", aliases: ["migration"], positionals: ["libraryId", "fromVersion", "toVersion"] },
  { name: "batch", tool: "gt_batch_resolve", aliases: ["batch-resolve"], positionals: ["...libraryNames"] },
  { name: "snippets", tool: "gt_snippets", aliases: [], positionals: ["libraryId", "...topic"] },
];

/** Commands that are not a single tool. */
export const META: ReadonlySet<string> = new Set(["tools", "call", "help"]);

/** Look a command up by name, alias or tool name. */
export function findCommand(word: string): Command | undefined {
  return COMMANDS.find((c) => c.name === word || c.tool === word || c.aliases.includes(word));
}

/**
 * Decide between the one-shot CLI and the MCP server. No arguments or a leading
 * flag keeps today's server path. An unknown bare word goes to the CLI only at
 * a terminal (so a typo fails fast); MCP clients pipe stdin and keep the server.
 */
export function route(args: readonly string[], stdinIsTTY: boolean): "cli" | "server" {
  const first = args[0];
  if (first === undefined || first.startsWith("-")) return "server";
  if (findCommand(first) !== undefined || META.has(first)) return "cli";
  return stdinIsTTY ? "cli" : "server";
}
