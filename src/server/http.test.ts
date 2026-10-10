import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "./http.js";
import { createMcpEndpoint, type McpEndpoint } from "./mcp-endpoint.js";

const LEGACY_VERSION = "2025-06-18";

interface Running {
  url: string;
  close: () => Promise<void>;
}

const running: Running[] = [];

async function start(stateful = false): Promise<Running> {
  const endpoint: McpEndpoint = createMcpEndpoint(stateful);
  const server = createHttpServer(endpoint);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const handle: Running = {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await endpoint.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  running.push(handle);
  return handle;
}

afterEach(async () => {
  delete process.env.GT_AUTH_TOKEN;
  await Promise.all(running.splice(0).map((r) => r.close()));
});

/** POST one JSON-RPC message the way a 2025-era Streamable HTTP client does. */
async function rpc(
  base: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; sessionId: string | null; message: Record<string, unknown> | undefined }> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...extraHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  });
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
    : text;
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    message: json ? (JSON.parse(json) as Record<string, unknown>) : undefined,
  };
}

const initialize = (id: number): Record<string, unknown> => ({
  id,
  method: "initialize",
  params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: "http-test", version: "0.0.0" } },
});

function toolCount(message: Record<string, unknown> | undefined): number {
  const result = message?.result as { tools?: unknown[] } | undefined;
  return result?.tools?.length ?? 0;
}

describe("HTTP transport (stateless default)", () => {
  it("serves two sequential POSTs", async () => {
    const { url } = await start();
    const first = await rpc(url, initialize(1));
    const second = await rpc(url, { id: 2, method: "tools/list" }, { "mcp-protocol-version": LEGACY_VERSION });

    expect(first.status).toBe(200);
    expect((first.message?.result as { serverInfo: { name: string } }).serverInfo.name).toBe("GroundTruth");
    expect(second.status).toBe(200);
    expect(toolCount(second.message)).toBe(14);
  });

  it("serves two concurrent initializes", async () => {
    const { url } = await start();
    const [a, b] = await Promise.all([rpc(url, initialize(1)), rpc(url, initialize(2))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.message?.result).toBeDefined();
    expect(b.message?.result).toBeDefined();
  });
});

describe("HTTP transport (GT_HTTP_STATEFUL=1)", () => {
  it("gives two concurrent clients their own working sessions", async () => {
    const { url } = await start(true);
    const [a, b] = await Promise.all([rpc(url, initialize(1)), rpc(url, initialize(2))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.sessionId).toBeTruthy();
    expect(b.sessionId).toBeTruthy();
    expect(a.sessionId).not.toBe(b.sessionId);

    for (const session of [a.sessionId!, b.sessionId!]) {
      const headers = { "mcp-session-id": session, "mcp-protocol-version": LEGACY_VERSION };
      await rpc(url, { method: "notifications/initialized" }, headers);
      const list = await rpc(url, { id: 3, method: "tools/list" }, headers);
      expect(list.status).toBe(200);
      expect(toolCount(list.message)).toBe(14);
    }
  });

  it("answers an unknown session id with 404", async () => {
    const { url } = await start(true);
    const res = await rpc(url, { id: 1, method: "tools/list" }, { "mcp-session-id": "nope", "mcp-protocol-version": LEGACY_VERSION });
    expect(res.status).toBe(404);
  });

  it("forgets a session after DELETE", async () => {
    const { url } = await start(true);
    const { sessionId } = await rpc(url, initialize(1));
    const headers = { "mcp-session-id": sessionId!, "mcp-protocol-version": LEGACY_VERSION };
    const del = await fetch(`${url}/mcp`, { method: "DELETE", headers });
    expect(del.status).toBe(200);
    expect((await rpc(url, { id: 2, method: "tools/list" }, headers)).status).toBe(404);
  });
});

describe("HTTP auth and endpoints", () => {
  it("rejects a wrong bearer token with 401", async () => {
    process.env.GT_AUTH_TOKEN = "s3cret-token";
    const { url } = await start();
    const wrong = await rpc(url, initialize(1), { authorization: "Bearer wrong-token!" });
    const missing = await fetch(`${url}/health`);
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
  });

  it("accepts the right bearer token", async () => {
    process.env.GT_AUTH_TOKEN = "s3cret-token";
    const { url } = await start();
    const ok = await rpc(url, initialize(1), { authorization: "Bearer s3cret-token" });
    expect(ok.status).toBe(200);
  });

  it("serves /health", async () => {
    const { url } = await start();
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { status: string; tools: number };
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.tools).toBe(14);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns 404 for unknown paths", async () => {
    const { url } = await start();
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});
