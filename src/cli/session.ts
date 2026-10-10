import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type CallToolResult,
  type JSONRPCMessage,
  type Tool,
} from "@modelcontextprotocol/server";
import { createServer } from "../server/factory.js";
import { SERVER_VERSION, TOOL_TIMEOUT_MS } from "../constants.js";

/** A JSON-RPC error response, e.g. -32602 for an unknown tool. */
export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Session {
  tools: Tool[];
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

type Waiter = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * Drive the real server in-process over a linked in-memory transport pair with
 * raw JSON-RPC, so input validation and isError wrapping are exactly what MCP
 * clients get.
 */
export async function openSession(): Promise<Session> {
  const [client, serverEnd] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, Waiter>();
  client.onmessage = (msg: JSONRPCMessage) => {
    if (!("id" in msg) || typeof msg.id !== "number" || "method" in msg) return;
    const waiter = waiting.get(msg.id);
    if (!waiter) return;
    waiting.delete(msg.id);
    if ("error" in msg) waiter.reject(new RpcError(msg.error.code, msg.error.message));
    else waiter.resolve(msg.result);
  };

  let nextId = 0;
  function request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      // Outlive the server-side tool budget so its own timeout result wins.
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new RpcError(-32001, `${method} timed out`));
      }, TOOL_TIMEOUT_MS + 5_000);
      timer.unref();
      const settle = <A>(fn: (a: A) => void) => (a: A) => { clearTimeout(timer); fn(a); };
      waiting.set(id, { resolve: settle((v) => resolve(v as T)), reject: settle(reject) });
      client.send({ jsonrpc: "2.0", id, method, params }).catch(settle(reject));
    });
  }

  await createServer().connect(serverEnd);
  await client.start();
  await request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "gt-mcp-cli", version: SERVER_VERSION },
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const { tools } = await request<{ tools: Tool[] }>("tools/list", {});

  return {
    tools,
    call: (name, args) => request<CallToolResult>("tools/call", { name, arguments: args }),
    close: () => client.close(),
  };
}
