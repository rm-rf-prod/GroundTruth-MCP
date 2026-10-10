import { describe, it, expect, afterEach, vi } from "vitest";
import { createMcpEndpoint, type McpEndpoint } from "./mcp-endpoint.js";

const LEGACY_VERSION = "2025-06-18";
const IDLE_MS = 60_000;

const endpoints: McpEndpoint[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(endpoints.splice(0).map((e) => e.close()));
});

function post(body: Record<string, unknown>, sessionId?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId !== undefined) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = LEGACY_VERSION;
  }
  return new Request("http://localhost/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...body }) });
}

async function openSession(endpoint: McpEndpoint): Promise<string> {
  const res = await endpoint.fetch(
    post({ id: 1, method: "initialize", params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
  );
  await res.text();
  const sessionId = res.headers.get("mcp-session-id");
  if (sessionId === null) throw new Error(`initialize failed: ${res.status}`);
  await (await endpoint.fetch(post({ method: "notifications/initialized" }, sessionId))).text();
  return sessionId;
}

async function listStatus(endpoint: McpEndpoint, sessionId: string): Promise<number> {
  const res = await endpoint.fetch(post({ id: 2, method: "tools/list" }, sessionId));
  await res.text();
  return res.status;
}

describe("stateful legacy sessions: idle expiry", () => {
  it("expires a session idle longer than the limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const endpoint = createMcpEndpoint(true, IDLE_MS);
    endpoints.push(endpoint);
    const sessionId = await openSession(endpoint);

    vi.setSystemTime(Date.now() + IDLE_MS + 1);
    expect(await listStatus(endpoint, sessionId)).toBe(404);
  });

  it("keeps a session alive while it is used inside the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const endpoint = createMcpEndpoint(true, IDLE_MS);
    endpoints.push(endpoint);
    const sessionId = await openSession(endpoint);

    vi.setSystemTime(Date.now() + IDLE_MS / 2);
    expect(await listStatus(endpoint, sessionId)).toBe(200);
    vi.setSystemTime(Date.now() + IDLE_MS / 2 + 1);
    expect(await listStatus(endpoint, sessionId)).toBe(200);
  });

  it("sweeps an abandoned session when another client arrives", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const endpoint = createMcpEndpoint(true, IDLE_MS);
    endpoints.push(endpoint);
    const abandoned = await openSession(endpoint);

    vi.setSystemTime(Date.now() + IDLE_MS + 1);
    await openSession(endpoint);
    expect(await listStatus(endpoint, abandoned)).toBe(404);
  });
});
