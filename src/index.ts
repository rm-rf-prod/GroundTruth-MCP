#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { getInstallId } from "./utils/watermark.js";
import { checkForUpdate, formatUpdateNotice, setPendingUpdate } from "./utils/version-check.js";
import { diskDocCache } from "./services/cache.js";
import { z } from "zod";
import { registerResolveTool } from "./tools/resolve.js";
import { registerDocsTool } from "./tools/docs.js";
import { registerBestPracticesTool } from "./tools/best-practices.js";
import { registerAutoScanTool } from "./tools/auto-scan.js";
import { registerSearchTool } from "./tools/search.js";
import { registerAuditTool } from "./tools/audit.js";
import { registerChangelogTool } from "./tools/changelog.js";
import { registerCompatTool } from "./tools/compat.js";
import { registerCompareTool } from "./tools/compare.js";
import { registerExamplesTool } from "./tools/examples.js";

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions: `GroundTruth — Universal Documentation and Best Practices Fetcher.

Covers: libraries, frameworks, web standards (MDN), security (OWASP), accessibility (WCAG), performance, HTTP, CSS, auth standards, databases, infrastructure, and more.

Tools:
1. gt_resolve_library — Resolve a library name to an ID and docs URL. Call this first.
2. gt_get_docs — Fetch up-to-date documentation filtered by topic.
3. gt_best_practices — Fetch latest best practices for a library.
4. gt_auto_scan — Detect all project dependencies and fetch best practices for each.
5. gt_search — Freeform search: web standards, security, accessibility, any topic.
6. gt_audit — Scan project code for real issues, fetch live fixes from official docs.
7. gt_changelog — Fetch recent release notes. Use before upgrading.
8. gt_compat — Check browser/runtime compatibility for a web API or CSS feature.
9. gt_compare — Compare 2–3 libraries side-by-side.
10. gt_examples — Find real-world code examples from GitHub for any library or pattern.

Workflows:
"use gt" → gt_auto_scan({})
"use gt for [library]" → gt_resolve_library → gt_best_practices
"find and fix all issues" → gt_audit({ projectPath: "." })
"check [topic]" → gt_search({ query: "[topic]" })
"show me examples of [library]" → gt_examples

All content is fetched live from official sources — no stale training data.`,
  },
);

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

// MCP Prompts — discoverable workflow templates shown as slash commands in compatible clients
server.prompt(
  "audit-my-project",
  "Scan this project for code issues and fetch live best-practice fixes from official docs",
  () => ({
    messages: [{
      role: "user",
      content: { type: "text", text: "Please use gt_audit to scan this project for all code issues (layout, performance, accessibility, security, React, Next.js, TypeScript, Node.js, Python). For each issue type found, fetch live best-practice fixes and show me what to change at each file:line location." },
    }],
  }),
);

server.prompt(
  "upgrade-check",
  "Check release notes and breaking changes before upgrading a library",
  { library: z.string().describe("Library to check, e.g. 'nextjs', 'react', 'prisma'") },
  ({ library }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Use gt_changelog to fetch the recent release notes for ${library}. Summarize what changed, highlight any breaking changes, and list migration steps if available.` },
    }],
  }),
);

server.prompt(
  "best-practices-scan",
  "Get current best practices for every library in this project",
  () => ({
    messages: [{
      role: "user",
      content: { type: "text", text: "Use gt_auto_scan to detect all dependencies in this project and fetch the latest best practices for each one. Highlight any patterns we should update." },
    }],
  }),
);

server.prompt(
  "compare-libraries",
  "Compare two or three libraries side-by-side to decide which one to use",
  { libraries: z.string().describe("Comma-separated library names, e.g. 'prisma, drizzle-orm' or 'zod, valibot, yup'") },
  ({ libraries }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Use gt_compare to compare these libraries side-by-side: ${libraries}. Show their key differences, tradeoffs, and which use cases each one fits best.` },
    }],
  }),
);

server.prompt(
  "security-check",
  "Search OWASP and security docs for guidance on a vulnerability or security topic",
  { topic: z.string().describe("Security topic, e.g. 'SQL injection', 'JWT best practices', 'CSP headers'") },
  ({ topic }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Use gt_search to find the latest OWASP guidance and security best practices for: ${topic}. Include prevention techniques, code examples if available, and any relevant CVEs or spec references.` },
    }],
  }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running via stdio [${getInstallId()}]`);

  // Non-blocking cache prune — removes expired entries and caps at 1000 files
  diskDocCache.prune(1000).catch(() => {});

  // Non-blocking update check — notifies user via MCP logging if a newer version exists
  checkForUpdate().then((latestVersion) => {
    if (latestVersion) {
      setPendingUpdate(latestVersion);
      const notice = formatUpdateNotice(latestVersion);
      console.error(notice);
      server.server.sendLoggingMessage({ level: "warning", data: notice }).catch(() => {});
    }
  }).catch(() => {});
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
