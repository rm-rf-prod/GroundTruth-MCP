import { SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from "../constants.js";
import { getInstallId } from "../utils/watermark.js";
import { LIBRARY_REGISTRY } from "../sources/registry.js";
import { renderRoutingTable } from "../services/intent-router.js";

/** Handle one-shot CLI flags. Exits the process when a flag matched. */
export function handleCliFlags(args: string[]): void {
    if (args.includes("--version") || args.includes("-v")) {
      process.stdout.write(`${SERVER_NAME} v${SERVER_VERSION}\n`);
      process.exit(0);
    }
    if (args.includes("--health")) {
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
      process.stdout.write(renderRoutingTable() + "\n");
      process.exit(0);
    }
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write([
        `${SERVER_NAME} v${SERVER_VERSION}`,
        "",
        "Usage:",
        "  gt-mcp [flags]",
        "",
        "Flags:",
        "  --version, -v     Print version and exit",
        "  --health          Print health JSON and exit",
        "  --routing-table   Print trigger-phrase routing table and exit",
        "  --help, -h        Print this help",
        "",
        "Environment:",
        "  GT_HTTP_PORT       Enable HTTP transport on port",
        "  GT_HTTP_STATEFUL   Set =1 for session-per-request mode",
        "  GT_AUTH_TOKEN      Bearer token required for HTTP endpoints",
        "  GT_GITHUB_TOKEN    GitHub API token for higher rate limits",
        "  GT_CACHE_DIR       Disk cache directory (default ~/.gt-mcp-cache)",
        "",
        "Without flags, runs as MCP server via stdio.",
        "",
      ].join("\n"));
      process.exit(0);
    }
}
