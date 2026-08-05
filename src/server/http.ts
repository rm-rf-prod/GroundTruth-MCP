import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from "../constants.js";
import { getInstallId } from "../utils/watermark.js";
import { LIBRARY_REGISTRY } from "../sources/registry.js";
import { docCache } from "../services/cache.js";
import { log } from "../utils/logger.js";
import { formatPrometheus, getUptimeSeconds } from "../services/metrics.js";
import { getCircuitSummary } from "../services/circuit-breaker.js";
import { getInvocationSummary } from "../services/telemetry.js";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
};

function healthPayload(): string {
  return JSON.stringify({
    status: "ok",
    uptime: getUptimeSeconds(),
    version: SERVER_VERSION,
    tools: TOOL_COUNT,
    registryEntries: LIBRARY_REGISTRY.length,
    cache: { memoryEntries: docCache.size(), diskInitialized: true },
    circuitBreakers: getCircuitSummary(),
    telemetry: getInvocationSummary(),
  });
}

/**
 * Serve MCP over Streamable HTTP plus the /health and /metrics endpoints.
 * Returns the listening server so the caller can close it on shutdown.
 */
export async function startHttpServer(
  server: McpServer,
  httpPort: string,
): Promise<import("http").Server> {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const http = await import("http");
  const crypto = await import("crypto");

  if (!process.env.GT_AUTH_TOKEN) {
    log({ level: "warn", msg: "GT_HTTP_PORT is set but GT_AUTH_TOKEN is unset -- /mcp, /health and /metrics are exposed without authentication" });
  }

  // Stateless mode by default — GT tools are independent doc fetches, no per-session state needed.
  // Set GT_HTTP_STATEFUL=1 to enable session-per-request via sessionIdGenerator.
  const transport = process.env.GT_HTTP_STATEFUL === "1"
    ? new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() })
    : new StreamableHTTPServerTransport({});
  transport.onclose = () => {};
  // SDK's StreamableHTTPServerTransport has onclose?: () => void while Transport requires
  // onclose: () => void — assigning above is the workaround. Cast below preserves runtime safety.
  await server.connect(transport as Parameters<typeof server.connect>[0]);

  const httpServer = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    const authToken = process.env.GT_AUTH_TOKEN;
    if (authToken) {
      // Constant-time comparison — avoids leaking the token via a response-time
      // side channel (string !== short-circuits on the first differing byte).
      const expected = Buffer.from(`Bearer ${authToken}`);
      const provided = Buffer.from(req.headers.authorization ?? "");
      const authorized =
        provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
      if (!authorized) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    if (req.url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
      // MCP Streamable HTTP: POST = client messages, GET = server-push SSE stream,
      // DELETE = session termination. The transport differentiates internally.
      await transport.handleRequest(req, res);
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(healthPayload());
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
    log({ level: "error", msg: "Invalid GT_HTTP_PORT -- must be 1-65535", value: httpPort });
    process.exit(1);
  }
  httpServer.listen(port, () => {
    log({ level: "info", msg: `${SERVER_NAME} v${SERVER_VERSION} running via HTTP on port ${httpPort} [${getInstallId()}]` });
  });
  return httpServer;
}
