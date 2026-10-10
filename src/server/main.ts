import { serveStdio, StdioServerTransport, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { McpServer } from "@modelcontextprotocol/server";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { config } from "../config.js";
import { getInstallId } from "../utils/watermark.js";
import { checkForUpdate, formatUpdateNotice, setPendingUpdate } from "../utils/version-check.js";
import { diskDocCache } from "../services/cache.js";
import { log } from "../utils/logger.js";
import { createServer } from "./factory.js";
import type { HttpHandle } from "./http.js";

const SHUTDOWN_TIMEOUT_MS = 3_000;

// Built at import time so registration is done before the first stdio message;
// the first stdio connection takes it, any later instance is built fresh.
let eagerServer: McpServer | undefined = createServer();
let stdioHandle: StdioServerHandle | undefined;
let httpHandle: HttpHandle | undefined;

function takeServer(): McpServer {
  const server = eagerServer ?? createServer();
  eagerServer = undefined;
  return server;
}

async function gracefulShutdown(): Promise<void> {
  const closing = Promise.allSettled([stdioHandle?.close(), httpHandle?.close()]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref());
  await Promise.race([closing, timeout]);
  process.exit(0);
}

async function main(): Promise<void> {
  const httpPort = process.env.GT_HTTP_PORT;
  if (httpPort) {
    // Loaded on demand so stdio startup never pays for the HTTP stack.
    const { startHttpServer } = await import("./http.js");
    httpHandle = startHttpServer(httpPort);
  } else {
    // serveStdio answers both 2026-07-28 (server/discover) and 2025-era (initialize) openings.
    stdioHandle = serveStdio(takeServer, {
      transport: new StdioServerTransport(),
      onerror: (error) => log({ level: "error", msg: "MCP stdio transport error", error: String(error) }),
    });
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

  // GT_NO_UPDATE_CHECK=1 means no registry request at all, not just no notice.
  if (config.noUpdateCheck) return;
  // Non-blocking update check — the notice reaches tool output via withNotice.
  checkForUpdate().then((latestVersion) => {
    if (latestVersion) {
      setPendingUpdate(latestVersion);
      log({ level: "warn", msg: formatUpdateNotice(latestVersion) });
    }
  }).catch(() => {});
}

process.on("SIGTERM", () => void gracefulShutdown());
process.on("SIGINT", () => void gracefulShutdown());

process.on("unhandledRejection", (reason: unknown) => {
  log({ level: "error", msg: "unhandledRejection", error: String(reason) });
  process.exit(1);
});

main().catch((err: unknown) => {
  log({ level: "error", msg: "Fatal error", error: String(err) });
  process.exit(1);
});
