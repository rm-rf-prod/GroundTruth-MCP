import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocsTool } from "./docs.js";
import { resetTelemetry } from "../services/telemetry.js";

interface RegisteredTool {
  handler: (
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ text: string }> }>;
}

interface InternalServer {
  _registeredTools?: Record<string, RegisteredTool>;
}

function getHandler(server: McpServer) {
  const internal = server as unknown as InternalServer;
  const tool = internal._registeredTools?.["gt_get_docs"];
  if (!tool) throw new Error("gt_get_docs not registered");
  return tool.handler;
}

describe("gt_get_docs — SSRF guard on libraryId URL construction", () => {
  beforeEach(() => {
    resetTelemetry();
    vi.restoreAllMocks();
  });

  it("rejects libraryId that resolves to AWS metadata", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDocsTool(server);
    const handler = getHandler(server);
    const result = await handler({
      libraryId: "169.254.169.254/latest/meta-data",
      tokens: 1000,
    });
    expect(result.content[0]?.text).toMatch(/private\/internal target|URL not allowed/i);
  });

  it("rejects libraryId that points to RFC1918 192.168.0.0/16", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDocsTool(server);
    const handler = getHandler(server);
    const result = await handler({
      libraryId: "192.168.1.1/admin",
      tokens: 1000,
    });
    expect(result.content[0]?.text).toMatch(/private\/internal target|URL not allowed/i);
  });

  it("rejects libraryId that points to RFC1918 10.0.0.0/8", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDocsTool(server);
    const handler = getHandler(server);
    const result = await handler({
      libraryId: "10.0.0.1/internal",
      tokens: 1000,
    });
    expect(result.content[0]?.text).toMatch(/private\/internal target|URL not allowed/i);
  });

  it("rejects http:// libraryId that points to private IP", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDocsTool(server);
    const handler = getHandler(server);
    const result = await handler({
      libraryId: "http://10.0.0.5/secret",
      tokens: 1000,
    });
    expect(result.content[0]?.text).toMatch(/URL not allowed|public HTTPS/i);
  });
});
