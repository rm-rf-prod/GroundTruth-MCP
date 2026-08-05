import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

/** Register every gt_* tool on the server, dispatch first. */
export function registerAllTools(server: McpServer): void {
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
}
