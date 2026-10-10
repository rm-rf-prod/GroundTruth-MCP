import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { TOOL_TIMEOUT_MS } from "../constants.js";
import { runWithCallSignal } from "../utils/guard.js";
import { registerResolveTool } from "../tools/resolve.js";
import { registerDocsTool } from "../tools/docs.js";
import { registerBestPracticesTool } from "../tools/best-practices.js";
import { registerAutoScanTool } from "../tools/auto-scan.js";
import { registerSearchTool } from "../tools/search.js";
import { registerAuditTool } from "../tools/audit.js";
import { registerChangelogTool } from "../tools/changelog.js";
import { registerCompatTool } from "../tools/compat.js";
import { registerCompareTool } from "../tools/compare.js";
import { registerExamplesTool } from "../tools/examples.js";
import { registerMigrationTool } from "../tools/migration.js";
import { registerBatchResolveTool } from "../tools/batch-resolve.js";
import { registerSnippetsTool } from "../tools/snippets.js";
import { registerDispatchTool } from "../tools/dispatch.js";

type ToolResult = Record<string, unknown>;
type ToolHandler = (args: unknown, ctx: ServerContext) => ToolResult | Promise<ToolResult>;
type RegisterTool = (name: string, config: unknown, cb: ToolHandler) => unknown;

// Claude Code shows the model ONLY structuredContent when a result carries it,
// so prose tools answer in text alone. These three return a complete
// machine-readable answer and keep it.
const STRUCTURED_TOOLS = new Set(["gt_resolve_library", "gt_batch_resolve", "gt_dispatch"]);

// These bound their network phase with withToolTimeout and a tailored fallback.
// A second deadline here could fire first and discard their partial results
// (gt_audit and gt_auto_scan start that timer only after local scanning).
const SELF_TIMED_TOOLS = new Set([
  "gt_audit", "gt_auto_scan", "gt_batch_resolve", "gt_changelog", "gt_compare",
  "gt_compat", "gt_examples", "gt_migration", "gt_snippets",
]);

function stopped(name: string, ctx: ServerContext, deadlineMs: number | undefined): ToolResult {
  const why = ctx.mcpReq.signal.aborted
    ? "was cancelled by the client"
    : `exceeded GT_TOOL_TIMEOUT_MS (${deadlineMs} ms)`;
  return {
    content: [{ type: "text", text: `${name} ${why}. No answer was produced. Retry with a narrower topic, or pass a direct docs URL to gt_get_docs.` }],
    isError: true,
  };
}

/** Bound a handler by the tool deadline and client cancellation, and apply the structuredContent policy. */
export function guardToolHandler(
  name: string,
  handler: ToolHandler,
  deadlineMs: number | undefined = SELF_TIMED_TOOLS.has(name) ? undefined : TOOL_TIMEOUT_MS,
): ToolHandler {
  const keepStructured = STRUCTURED_TOOLS.has(name);
  return async (args, ctx) => {
    const deadline = new AbortController();
    const timer = deadlineMs === undefined ? undefined : setTimeout(() => deadline.abort(), deadlineMs);
    const signal = AbortSignal.any([ctx.mcpReq.signal, deadline.signal]);
    let onAbort = (): void => {};
    const abandoned = new Promise<null>((resolve) => {
      onAbort = () => resolve(null);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    let result: ToolResult | null;
    try {
      result = await Promise.race([runWithCallSignal(signal, () => handler(args, ctx)), abandoned]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
    if (result === null) return stopped(name, ctx, deadlineMs);
    if (keepStructured || !("structuredContent" in result)) return result;
    const { structuredContent: _dropped, ...text } = result;
    return text;
  };
}

/** Register every gt_* tool on the server, dispatch first. */
export function registerAllTools(server: McpServer): void {
  const original = server.registerTool;
  const register = original.bind(server) as unknown as RegisterTool;
  // Patch the instance rather than pass a facade: every register* function
  // still receives the McpServer itself.
  const guarded: RegisterTool = (name, config, cb) => register(name, config, guardToolHandler(name, cb));
  server.registerTool = guarded as unknown as McpServer["registerTool"];
  try {
    registerDispatchTool(server);
    registerResolveTool(server);
    registerDocsTool(server);
    registerBestPracticesTool(server);
    registerAutoScanTool(server);
    registerSearchTool(server);
    registerAuditTool(server);
    registerChangelogTool(server);
    registerCompatTool(server);
    registerCompareTool(server);
    registerExamplesTool(server);
    registerMigrationTool(server);
    registerBatchResolveTool(server);
    registerSnippetsTool(server);
  } finally {
    server.registerTool = original;
  }
}
