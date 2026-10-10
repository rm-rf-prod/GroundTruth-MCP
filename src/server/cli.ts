import { SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from "../constants.js";
import { COMMANDS } from "../cli/commands.js";

function commandLines(): string[] {
  const rows = COMMANDS.map((c) => [
    [c.name, ...c.aliases].join(", "),
    c.positionals.map((p) => (p.startsWith("...") ? `<${p.slice(3)}...>` : `<${p}>`)).join(" "),
    c.tool,
  ]);
  rows.push(
    ["tools", "[--json]", "list tools and their arguments"],
    ["call", "<tool> [<json>|-] [--json]", "call any tool with JSON arguments"],
    ["help", "[command]", "flags generated from the tool's schema"],
  );
  const w0 = Math.max(...rows.map((r) => r[0]?.length ?? 0));
  const w1 = Math.max(...rows.map((r) => r[1]?.length ?? 0));
  return rows.map(([a = "", b = "", c = ""]) => `  ${a.padEnd(w0)}  ${b.padEnd(w1)}  ${c}`);
}

// Every variable read anywhere; config.ts validates the numeric ones at startup.
const ENV: ReadonlyArray<readonly [string, string]> = [
  ["GT_HTTP_PORT", "Serve MCP over Streamable HTTP on this port instead of stdio"],
  ["GT_HTTP_HOST", "HTTP bind address (default 127.0.0.1; any other needs GT_AUTH_TOKEN)"],
  ["GT_HTTP_ALLOWED_HOSTS", "Comma-separated extra Host/Origin values the HTTP server accepts"],
  ["GT_HTTP_STATEFUL", "Set =1 for a session per client, for 2025-era HTTP clients"],
  ["GT_AUTH_TOKEN", "Bearer token required on /mcp, /health and /metrics"],
  ["GT_GITHUB_TOKEN", "GitHub API token: 5000 req/h instead of 60, enables gt_examples code search"],
  ["GT_JINA_API_KEY", "Jina Reader key, lifts page rendering off the anonymous rate limit"],
  ["GT_CACHE_DIR", "Disk cache directory (default ~/.gt-mcp-cache)"],
  ["GT_CACHE_TTL_MS", "Default cache lifetime (default 1800000)"],
  ["GT_SWR_STALE_TTL_MS", "How long past expiry a cached page may still be served (default 3600000)"],
  ["GT_TOKEN_LIMIT", "Default answer size in tokens (default 8000)"],
  ["GT_MAX_TOKEN_LIMIT", "Largest tokens value a call may ask for (default 20000)"],
  ["GT_TOOL_TIMEOUT_MS", "Deadline per tool call (default 55000)"],
  ["GT_FETCH_TIMEOUT_MS", "Timeout per outbound HTTP request (default 15000)"],
  ["GT_MAX_CONCURRENT_FETCHES", "Outbound requests in flight at once (default 12)"],
  ["GT_CONCURRENCY", "Parallel library fetches in gt_auto_scan (default 8, max 12)"],
  ["GT_DEEP_FETCH_MAX_PAGES", "Linked pages read when the first page misses the topic (default 8)"],
  ["GT_DEEP_FETCH_RELEVANCE_THRESHOLD", "First-page topic relevance, 0-1, that skips the deep fetch (default 0.3)"],
  ["GT_DEEP_FETCH_TIMEOUT_MS", "Time budget for one deep fetch (default 25000)"],
  ["GT_CIRCUIT_BREAKER_THRESHOLD", "Consecutive failures before a host is skipped (default 3)"],
  ["GT_CIRCUIT_BREAKER_RESET_MS", "How long a failing host is skipped (default 60000)"],
  ["GT_LOG_FORMAT", "text|json (default text)"],
  ["GT_LOG_LEVEL", "debug|info|warn|error (commands default to warn)"],
  ["GT_NO_UPDATE_CHECK", "Set =1 to skip the npm registry update check and its notice"],
  ["GT_NO_WATERMARK", "Set =1 to drop the notice line and invisible watermark"],
  ["NODE_DISABLE_COMPILE_CACHE", "Set =1 to skip the on-disk compile cache"],
];

function envLines(): string[] {
  const width = Math.max(...ENV.map(([name]) => name.length));
  return ENV.map(([name, meaning]) => `  ${name.padEnd(width)}  ${meaning}`);
}

export function helpText(): string {
  return [
    `${SERVER_NAME} v${SERVER_VERSION}`,
    "",
    "Usage:",
    "  gt-mcp [flags]                     Run the MCP server (stdio, or HTTP with GT_HTTP_PORT)",
    "  gt-mcp <command> [args] [flags]    Run one tool and print its result",
    "",
    "Commands:",
    ...commandLines(),
    "",
    "Command flags:",
    "  --json            Print the full CallToolResult as JSON",
    "  --help, -h        Show the command's flags",
    "  Exit codes: 0 ok, 1 tool error, 2 usage error",
    "",
    "Flags:",
    "  --version, -v     Print version and exit",
    "  --health          Print health JSON and exit",
    "  --routing-table   Print trigger-phrase routing table and exit",
    "  --help, -h        Print this help",
    "",
    "Environment:",
    ...envLines(),
    "",
    "Without a command or flag, runs as MCP server via stdio.",
    "",
  ].join("\n");
}

/** Handle one-shot CLI flags. Exits the process when a flag matched. */
export async function handleCliFlags(args: string[]): Promise<void> {
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${SERVER_NAME} v${SERVER_VERSION}\n`);
    process.exit(0);
  }
  if (args.includes("--health")) {
    // Loaded here only: the registry and watermark are the slow part of this file.
    const [{ getInstallId }, { LIBRARY_REGISTRY }] = await Promise.all([
      import("../utils/watermark.js"),
      import("../sources/registry.js"),
    ]);
    process.stdout.write(JSON.stringify({
      status: "ok",
      name: SERVER_NAME,
      version: SERVER_VERSION,
      installId: getInstallId(),
      tools: TOOL_COUNT,
      registryEntries: LIBRARY_REGISTRY.length,
      node: process.version,
    }) + "\n");
    process.exit(0);
  }
  if (args.includes("--routing-table")) {
    const { renderRoutingTable } = await import("../services/intent-router.js");
    process.stdout.write(renderRoutingTable() + "\n");
    process.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(helpText());
    process.exit(0);
  }
}
