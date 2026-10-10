import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { access, constants as fsConstants, mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  validateHostHeader,
  validateOriginHeader,
} from "@modelcontextprotocol/server";
import { DISK_CACHE_DIR, SERVER_NAME, SERVER_VERSION, TOOL_COUNT } from "../constants.js";
import { getInstallId } from "../utils/watermark.js";
import { LIBRARY_REGISTRY } from "../sources/registry.js";
import { docCache } from "../services/cache.js";
import { log } from "../utils/logger.js";
import { formatPrometheus, getUptimeSeconds } from "../services/metrics.js";
import { getCircuitSummary } from "../services/circuit-breaker.js";
import { getInvocationSummary } from "../services/telemetry.js";
import { createMcpEndpoint, type McpEndpoint } from "./mcp-endpoint.js";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
};

/** Real disk-cache check: the dir exists (or can be created) and this process can write to it. */
async function diskCacheWritable(): Promise<boolean> {
  try {
    await mkdir(DISK_CACHE_DIR, { recursive: true });
    await access(DISK_CACHE_DIR, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function healthPayload(): Promise<string> {
  const diskInitialized = await diskCacheWritable();
  return JSON.stringify({
    // Degraded, not down: the memory cache keeps serving when the disk cache is unusable.
    status: diskInitialized ? "ok" : "degraded",
    uptime: getUptimeSeconds(),
    version: SERVER_VERSION,
    tools: TOOL_COUNT,
    registryEntries: LIBRARY_REGISTRY.length,
    cache: { memoryEntries: docCache.size(), diskInitialized },
    circuitBreakers: getCircuitSummary(),
    telemetry: getInvocationSummary(),
  });
}

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Constant-time bearer check; hashing first keeps the token length out of the timing. Unset GT_AUTH_TOKEN (loopback binds only) leaves the server open. */
function isAuthorized(req: IncomingMessage): boolean {
  const authToken = process.env.GT_AUTH_TOKEN;
  if (!authToken) return true;
  return timingSafeEqual(sha256(req.headers.authorization ?? ""), sha256(`Bearer ${authToken}`));
}

export interface HttpServerOptions {
  /**
   * Hostnames accepted in Host and Origin besides loopback. `null` turns the Host
   * check off (public bind without an allowlist); Origin is checked regardless.
   */
  allowedHosts?: string[] | null;
}

/** DNS-rebinding and cross-site guard: the 403 reason, or undefined when the request may proceed. */
function rejectHostOrOrigin(req: IncomingMessage, allowedHosts: string[] | null | undefined): string | undefined {
  const extra = allowedHosts ?? [];
  if (allowedHosts !== null) {
    const host = validateHostHeader(req.headers.host, [...localhostAllowedHostnames(), ...extra]);
    if (!host.ok) return host.message;
  }
  const origin = validateOriginHeader(req.headers.origin, [...localhostAllowedOrigins(), ...extra]);
  return origin.ok ? undefined : origin.message;
}

function toWebRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  // The SDK enforces its own body-size limit while reading this stream.
  const body = hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : null;
  return new Request(new URL(req.url ?? "/", "http://localhost"), { method, headers, body, signal, duplex: "half" });
}

async function serveMcp(endpoint: McpEndpoint, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  let response: Response;
  try {
    response = await endpoint.fetch(toWebRequest(req, abort.signal));
  } catch (error) {
    log({ level: "error", msg: "MCP HTTP request failed", error: String(error) });
    response = Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, { status: 500 });
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    res.end();
    return;
  }
  // Rejects only when the client disconnects mid-stream; the abort above already cancelled the exchange.
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), res).catch(() => {});
}

/** Node HTTP server for /mcp, /health and /metrics. Does not listen. */
export function createHttpServer(endpoint: McpEndpoint, options: HttpServerOptions = {}): Server {
  return createNodeServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    const rejected = rejectHostOrOrigin(req, options.allowedHosts);
    if (rejected !== undefined) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: rejected }, id: null }));
      return;
    }

    if (!isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    if (req.url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
      await serveMcp(endpoint, req, res);
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(await healthPayload());
    } else if (req.method === "GET" && req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(formatPrometheus());
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

export interface HttpHandle {
  close(): Promise<void>;
}

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");

/**
 * Serve MCP over Streamable HTTP on GT_HTTP_HOST (default 127.0.0.1) and httpPort.
 * The handle closes the endpoint, then the listener.
 */
export function startHttpServer(httpPort: string): HttpHandle {
  const port = parseInt(httpPort, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    log({ level: "error", msg: "Invalid GT_HTTP_PORT -- must be 1-65535", value: httpPort });
    process.exit(1);
  }
  const host = process.env.GT_HTTP_HOST || "127.0.0.1";
  const allowedHosts = (process.env.GT_HTTP_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const loopback = isLoopback(host);
  if (!process.env.GT_AUTH_TOKEN) {
    if (!loopback) {
      log({
        level: "error",
        msg: `Refusing to listen on ${host} without GT_AUTH_TOKEN -- anyone who can reach this port could use the server as a fetch proxy and run gt_audit/gt_auto_scan on server paths. Set GT_AUTH_TOKEN or bind 127.0.0.1 behind a TLS proxy.`,
      });
      process.exit(1);
    }
    log({ level: "warn", msg: "GT_AUTH_TOKEN is unset -- /mcp, /health and /metrics accept any local caller" });
  }

  const endpoint = createMcpEndpoint(process.env.GT_HTTP_STATEFUL === "1");
  // Bound publicly without an allowlist, any Host is legitimate (IPs, proxies); auth is the gate there.
  const httpServer = createHttpServer(endpoint, { allowedHosts: loopback || allowedHosts.length > 0 ? allowedHosts : null });
  httpServer.listen(port, host, () => {
    log({ level: "info", msg: `${SERVER_NAME} v${SERVER_VERSION} running via HTTP on ${host}:${port} [${getInstallId()}]` });
  });
  return {
    close: async () => {
      await endpoint.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
