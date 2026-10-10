import { randomUUID } from "node:crypto";
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { log } from "../utils/logger.js";
import { createServer } from "./factory.js";

/** Web-standard face of the /mcp endpoint. */
export interface McpEndpoint {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function logTransportError(error: unknown): void {
  log({ level: "error", msg: "MCP HTTP transport error", error: String(error) });
}

/** A 2025-era session unused for this long is closed; its client gets 404 and re-initializes. */
const SESSION_IDLE_MS = 30 * 60_000;

interface LegacySession {
  transport: WebStandardStreamableHTTPServerTransport;
  lastSeen: number;
}

/**
 * Stateless (default): every exchange gets a fresh server from the factory,
 * for 2026-07-28 clients and, through the SDK's stateless fallback, for
 * 2025-era clients too. Stateful: 2026-07-28 traffic stays per-request (that
 * revision has no sessions); 2025-era clients get one session each.
 */
export function createMcpEndpoint(stateful: boolean, sessionIdleMs = SESSION_IDLE_MS): McpEndpoint {
  if (!stateful) return createMcpHandler(createServer, { onerror: logTransportError });

  const modern = createMcpHandler(createServer, { legacy: "reject", onerror: logTransportError });
  const sessions = new Map<string, LegacySession>();

  // shortcut: idle sessions are swept on the next legacy request, not by a timer, so an
  // idle server keeps them until traffic resumes; add an unref'd interval if that matters.
  function sweepIdle(now: number): void {
    for (const [id, session] of sessions) {
      if (now - session.lastSeen <= sessionIdleMs) continue;
      sessions.delete(id);
      session.transport.close().catch(logTransportError);
    }
  }

  async function serveLegacy(request: Request): Promise<Response> {
    const now = Date.now();
    sweepIdle(now);
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId !== null) {
      const existing = sessions.get(sessionId);
      if (existing) {
        existing.lastSeen = now;
        return existing.transport.handleRequest(request);
      }
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
        { status: 404 },
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, lastSeen: Date.now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
    };
    transport.onerror = logTransportError;

    const server = createServer();
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // No session id means this was not a successful initialize: nothing to keep.
    if (transport.sessionId === undefined) await server.close();
    return response;
  }

  return {
    fetch: async (request) => ((await isLegacyRequest(request)) ? serveLegacy(request) : modern.fetch(request)),
    close: async () => {
      await modern.close();
      await Promise.allSettled([...sessions.values()].map((session) => session.transport.close()));
    },
  };
}
