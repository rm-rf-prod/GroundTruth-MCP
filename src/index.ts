#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { getInstallId } from "./utils/watermark.js";
import { checkForUpdate, formatUpdateNotice, setPendingUpdate } from "./utils/version-check.js";
import { diskDocCache, docCache } from "./services/cache.js";
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
import { registerMigrationTool } from "./tools/migration.js";
import { registerBatchResolveTool } from "./tools/batch-resolve.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIBRARY_REGISTRY, lookupById } from "./sources/registry.js";
import { fetchDocs } from "./services/fetcher.js";
import { extractRelevantContent } from "./utils/extract.js";
import { sanitizeContent } from "./utils/sanitize.js";
import { withNotice } from "./utils/guard.js";
import { DEFAULT_TOKEN_LIMIT } from "./constants.js";
import { log } from "./utils/logger.js";
import { formatPrometheus, getUptimeSeconds } from "./services/metrics.js";
import { getCircuitSummary } from "./services/circuit-breaker.js";

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
11. gt_migration — Fetch migration guides, breaking changes, and upgrade instructions.
12. gt_batch_resolve — Resolve multiple library names in one call (max 20).

Workflows:
"use gt" → gt_auto_scan({})
"use gt for [library]" → gt_resolve_library → gt_best_practices
"find and fix all issues" → gt_audit({ projectPath: ".", categories: ["all"] })
"what can be improved" → gt_audit({ categories: ["all"] }) + gt_auto_scan({})
"check [topic]" → gt_search({ query: "[topic]" })
"show me examples of [library]" → gt_examples
"migrate [library]" → gt_migration({ libraryId: "[id]" })

For broad or vague questions ("anything to improve?", "quality of life?", "what did I miss?"), combine gt_audit with categories: ["all"] and gt_auto_scan. The audit finds code-level issues; auto_scan finds outdated patterns per dependency.

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
registerMigrationTool(server);
registerBatchResolveTool(server);

// MCP Resources — browsable documentation and registry data
server.registerResource(
  "library-registry",
  "gt://registry",
  { description: "List of all supported libraries with IDs and docs URLs" },
  async () => ({
    contents: [{
      uri: "gt://registry",
      mimeType: "application/json",
      text: JSON.stringify(
        LIBRARY_REGISTRY.map((e) => ({ id: e.id, name: e.name, docsUrl: e.docsUrl })),
        null,
        2,
      ),
    }],
  }),
);

server.registerResource(
  "library-docs",
  new ResourceTemplate("gt://docs/{libraryId}", { list: undefined }),
  { description: "Fetch documentation for a library by its registry ID" },
  async (uri, { libraryId }) => {
    const id = Array.isArray(libraryId) ? libraryId[0] ?? "" : libraryId ?? "";
    const entry = lookupById(id);
    if (!entry) {
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Library not found: ${id}` }] };
    }
    try {
      const result = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl);
      const safe = sanitizeContent(result.content);
      const { text } = extractRelevantContent(safe, "", DEFAULT_TOKEN_LIMIT);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: withNotice(text) }] };
    } catch {
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Failed to fetch docs for ${entry.name}` }] };
    }
  },
);

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

server.prompt(
  "migration-guide",
  "Check migration guides and breaking changes for upgrading a library between versions",
  {
    library: z.string().describe("Library to migrate, e.g. 'nextjs', 'react', 'tailwind'"),
    fromVersion: z.string().optional().describe("Version migrating from, e.g. '14'"),
    toVersion: z.string().optional().describe("Version migrating to, e.g. '15'"),
  },
  ({ library, fromVersion, toVersion }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Use gt_changelog and gt_get_docs to find the migration guide for ${library}${fromVersion ? ` from v${fromVersion}` : ""}${toVersion ? ` to v${toVersion}` : ""}. List all breaking changes, required code modifications, and step-by-step upgrade instructions.`,
      },
    }],
  }),
);

server.prompt(
  "find-examples",
  "Find real-world code examples of a pattern using a specific library",
  {
    library: z.string().describe("Library name, e.g. 'react', 'drizzle-orm'"),
    pattern: z.string().describe("Pattern or feature, e.g. 'server actions', 'middleware', 'RLS policies'"),
  },
  ({ library, pattern }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Use gt_examples to find real-world code examples of "${pattern}" using ${library}. Show the most relevant examples with context and explain the patterns used.`,
      },
    }],
  }),
);

server.prompt(
  "dependency-audit",
  "Scan project dependencies for outdated patterns and fetch current best practices",
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: "Use gt_auto_scan to detect all dependencies in this project, then for each one check if we're using any deprecated patterns. Flag outdated code and fetch the current recommended approach from official docs.",
      },
    }],
  }),
);

let activeHttpServer: import("http").Server | undefined;

function gracefulShutdown(): void {
  server.close().catch(() => {});
  if (activeHttpServer) activeHttpServer.close();
  process.exit(0);
}

async function main(): Promise<void> {
  const httpPort = process.env.GT_HTTP_PORT;

  if (httpPort) {
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const http = await import("http");
    const crypto = await import("crypto");

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    transport.onclose = () => {};
    // @ts-expect-error -- SDK's StreamableHTTPServerTransport has onclose?: () => void, but Transport requires onclose: () => void. We assign it above.
    await server.connect(transport);

    const httpServer = http.createServer(async (req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");

      const authToken = process.env.GT_AUTH_TOKEN;
      if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (req.method === "POST" && req.url === "/mcp") {
        await transport.handleRequest(req, res);
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          uptime: getUptimeSeconds(),
          version: SERVER_VERSION,
          cache: {
            memoryEntries: docCache.size(),
            diskInitialized: true,
          },
          circuitBreakers: getCircuitSummary(),
        }));
      } else if (req.method === "GET" && req.url === "/metrics") {
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(formatPrometheus());
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const port = parseInt(httpPort, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      log({ level: "error", msg: `Invalid GT_HTTP_PORT: "${httpPort}" -- must be 1-65535` });
      process.exit(1);
    }
    activeHttpServer = httpServer;
    httpServer.listen(port, () => {
      log({ level: "info", msg: `${SERVER_NAME} v${SERVER_VERSION} running via HTTP on port ${httpPort} [${getInstallId()}]` });
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log({ level: "info", msg: `${SERVER_NAME} v${SERVER_VERSION} running via stdio [${getInstallId()}]` });
  }

  // Non-blocking cache prune — removes expired entries and caps at 1000 files
  diskDocCache.prune(1000).catch(() => {});

  // Non-blocking update check — notifies user via MCP logging if a newer version exists
  checkForUpdate().then((latestVersion) => {
    if (latestVersion) {
      setPendingUpdate(latestVersion);
      const notice = formatUpdateNotice(latestVersion);
      log({ level: "warn", msg: notice });
      server.server.sendLoggingMessage({ level: "warning", data: notice }).catch(() => {});
    }
  }).catch(() => {});
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on("unhandledRejection", (reason: unknown) => {
  log({ level: "error", msg: "unhandledRejection", error: String(reason) });
  process.exit(1);
});

main().catch((err: unknown) => {
  log({ level: "error", msg: "Fatal error", error: String(err) });
  process.exit(1);
});
