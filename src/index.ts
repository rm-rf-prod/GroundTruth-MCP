#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from "./constants.js";
import { getInstallId } from "./utils/watermark.js";
import { checkForUpdate, formatUpdateNotice, setPendingUpdate } from "./utils/version-check.js";
import { diskDocCache } from "./services/cache.js";
import { log } from "./utils/logger.js";
import { buildServerInstructions } from "./services/server-instructions.js";
import { registerAllTools } from "./server/register-tools.js";
import { registerResources } from "./server/resources.js";
import { registerPrompts } from "./server/prompts.js";
import { handleCliFlags } from "./server/cli.js";
import { startHttpServer } from "./server/http.js";

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions: buildServerInstructions(TOOL_COUNT),
  },
);

registerAllTools(server);
registerResources(server);
registerPrompts(server);

let activeHttpServer: import("http").Server | undefined;

function gracefulShutdown(): void {
  server.close().catch(() => {});
  if (activeHttpServer) activeHttpServer.close();
  process.exit(0);
}

async function main(): Promise<void> {
  handleCliFlags(process.argv.slice(2));

  const httpPort = process.env.GT_HTTP_PORT;
  if (httpPort) {
    activeHttpServer = await startHttpServer(server, httpPort);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log({ level: "info", msg: `${SERVER_NAME} v${SERVER_VERSION} running via stdio [${getInstallId()}]` });
  }

  // Non-blocking cache prune — removes expired entries and caps at 1000 files.
  // Repeated hourly: a long-lived stdio session can blow past the cap many
  // times over, and a boot-only prune never brings it back down.
  diskDocCache.prune(1000).catch(() => {});
  const pruneTimer = setInterval(() => {
    diskDocCache.prune(1000).catch(() => {});
  }, 3_600_000);
  pruneTimer.unref();

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
