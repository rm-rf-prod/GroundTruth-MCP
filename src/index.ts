#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerResolveTool } from "./tools/resolve.js";
import { registerDocsTool } from "./tools/docs.js";
import { registerBestPracticesTool } from "./tools/best-practices.js";
import { registerAutoScanTool } from "./tools/auto-scan.js";
import { registerSearchTool } from "./tools/search.js";
import { registerAuditTool } from "./tools/audit.js";

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions: `WS MCP Server — Universal Documentation and Best Practices Fetcher.

Covers: libraries, frameworks, web standards (MDN), security (OWASP), accessibility (WCAG),
performance (Core Web Vitals), HTTP, CSS, auth standards, databases, infrastructure, and more.

Available tools:
1. ws_resolve_library — Resolve a library name to a WS ID and docs URL. Call this first when you know the library name.
2. ws_get_docs — Fetch up-to-date documentation for any library, filtered by topic.
3. ws_best_practices — Fetch latest best practices, patterns, and guidelines for a specific library.
4. ws_auto_scan — Auto-detect ALL project dependencies (package.json, requirements.txt, etc.) and fetch best practices for each. Use when the user says "use ws" without specifying a library.
5. ws_search — Freeform search for ANY topic including web standards, security, accessibility, and anything else. No library name needed.
6. ws_audit — Scan actual project code files for real issues (layout shifts, perf, a11y, security, React, Next.js, TypeScript), then fetch live best practices for each issue type from official docs. Returns file+line locations so you can fix everything.

Quick Workflows:

"use ws" or "use ws for latest best practices":
  → ws_auto_scan({}) to scan current project
  → OR ws_search({ query: "latest best practices for [detected tech]" })

"use ws to check [topic]":
  → ws_search({ query: "[topic]" })

"use ws for [library]":
  → ws_resolve_library({ libraryName: "[library]" })
  → ws_best_practices({ libraryId: "...", topic: "..." })

When you do NOT know what library to look up — use ws_auto_scan or ws_search.

"find and fix all issues" / "use ws to audit":
  → ws_audit({ projectPath: "." }) to scan code for real bugs/issues
  → Apply fixes at the returned file:line locations using live best practices

All content is fetched live from official sources — no stale training data.`,
  },
);

registerResolveTool(server);
registerDocsTool(server);
registerBestPracticesTool(server);
registerAutoScanTool(server);
registerSearchTool(server);
registerAuditTool(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running via stdio`);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
