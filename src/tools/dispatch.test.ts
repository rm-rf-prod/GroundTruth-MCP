import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDispatchTool } from "./dispatch.js";
import { resetTelemetry, getRecentOutcomes } from "../services/telemetry.js";

interface ToolHandlerContext {
  signal?: AbortSignal;
}

interface RegisteredTool {
  handler: (args: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<unknown>;
}

interface InternalServer {
  _registeredTools?: Record<string, RegisteredTool>;
}

function getHandler(server: McpServer, name: string) {
  const internal = server as unknown as InternalServer;
  const tool = internal._registeredTools?.[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler;
}

describe("gt_dispatch tool", () => {
  beforeEach(() => {
    resetTelemetry();
  });

  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    expect(() => getHandler(server, "gt_dispatch")).not.toThrow();
  });

  it("returns routing decision for 'use gt'", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    const handler = getHandler(server, "gt_dispatch");
    const result = (await handler({ query: "use gt" })) as {
      content: Array<{ text: string }>;
      structuredContent?: { tool: string; confidence: number };
    };
    expect(result.content[0]?.text).toContain("gt_auto_scan");
    expect(result.structuredContent?.tool).toBe("gt_auto_scan");
    expect(result.structuredContent?.confidence).toBeGreaterThan(0.5);
  });

  it("returns routing decision for 'use gt for next.js'", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    const handler = getHandler(server, "gt_dispatch");
    const result = (await handler({ query: "use gt for next.js" })) as {
      structuredContent?: { tool: string; args: Record<string, unknown> };
    };
    expect(result.structuredContent?.tool).toBe("gt_best_practices");
    expect(result.structuredContent?.args["libraryId"]).toBe("vercel/next.js");
  });

  it("records telemetry on every invocation", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    const handler = getHandler(server, "gt_dispatch");
    await handler({ query: "use gt" });
    const outcomes = getRecentOutcomes();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.tool).toBe("gt_dispatch");
    expect(outcomes[0]?.success).toBe(true);
    expect(outcomes[0]?.resolved).toBe(true);
  });

  it("includes routing table in response text", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    const handler = getHandler(server, "gt_dispatch");
    const result = (await handler({ query: "use gt" })) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toContain("Trigger phrase routing");
    expect(result.content[0]?.text).toContain("| User input pattern");
  });

  it("respects projectPath argument for project-level routing", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    const handler = getHandler(server, "gt_dispatch");
    const result = (await handler({ query: "use gt", projectPath: "/tmp" })) as {
      structuredContent?: { args: Record<string, unknown> };
    };
    expect(String(result.structuredContent?.args["projectPath"] ?? "")).toContain("/tmp");
  });

  it("never returns empty content", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerDispatchTool(server);
    const handler = getHandler(server, "gt_dispatch");
    const queries = [
      "use gt",
      "explain how to do X",
      "asdfghjkl",
      "https://example.com/docs",
      "find issues",
      "compare a vs b",
      "migrate from 1 to 2",
    ];
    for (const q of queries) {
      const result = (await handler({ query: q })) as { content: Array<{ text: string }> };
      expect(result.content[0]?.text.length).toBeGreaterThan(200);
    }
  });
});
