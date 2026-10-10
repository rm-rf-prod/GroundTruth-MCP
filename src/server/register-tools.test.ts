import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { registerAllTools, guardToolHandler } from "./register-tools.js";
import { currentCallSignal } from "../utils/guard.js";

type Result = Record<string, unknown>;
type Handler = (args: unknown, ctx: ServerContext) => Promise<Result>;

const STRUCTURED = ["gt_batch_resolve", "gt_dispatch", "gt_resolve_library"];

function fakeServer() {
  const handlers = new Map<string, Handler>();
  const registerTool = (name: string, _config: unknown, cb: Handler) => { handlers.set(name, cb); };
  const server = { registerTool } as unknown as McpServer;
  return { server, handlers, registerTool };
}

function ctxWith(signal = new AbortController().signal): ServerContext {
  return { mcpReq: { signal } } as unknown as ServerContext;
}

const stub: Handler = async () => ({
  content: [{ type: "text", text: "answer" }],
  structuredContent: { content: "answer" },
});

describe("registerAllTools", () => {
  const { server, handlers, registerTool } = fakeServer();
  registerAllTools(server);

  it("registers all 14 tools and restores the instance's registerTool", () => {
    expect(handlers.size).toBe(14);
    expect(server.registerTool).toBe(registerTool);
  });

  it("strips structuredContent from every prose tool and keeps it for the three structured ones", async () => {
    for (const name of handlers.keys()) {
      const result = await guardToolHandler(name, stub)({}, ctxWith());
      expect(result["content"], name).toBeDefined();
      expect("structuredContent" in result, name).toBe(STRUCTURED.includes(name));
    }
  });

  const dir = mkdtempSync(join(tmpdir(), "gt-register-tools-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("wraps the real handlers: gt_auto_scan answers in text only", async () => {
    // Only unknown deps, so the report renders without any network fetch.
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { "zz-not-a-real-lib-xq": "1.0.0" } }));
    const result = await handlers.get("gt_auto_scan")!({ projectPath: dir, topic: "x", tokensPerLib: 1500 }, ctxWith());
    expect(result["structuredContent"]).toBeUndefined();
    expect(JSON.stringify(result["content"])).toContain("zz-not-a-real-lib-xq");
  });

  it("wraps the real handlers: gt_dispatch keeps its routing decision", async () => {
    const result = await handlers.get("gt_dispatch")!({ query: "compare prisma vs drizzle" }, ctxWith());
    expect(result["structuredContent"]).toMatchObject({ tool: "gt_compare" });
  });
});

describe("guardToolHandler deadline and cancellation", () => {
  const never: Handler = () => new Promise<Result>(() => { /* never settles */ });

  it("returns an isError result once the deadline passes", async () => {
    const started = Date.now();
    const result = await guardToolHandler("gt_get_docs", never, 30)({}, ctxWith());
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result["isError"]).toBe(true);
    expect(JSON.stringify(result["content"])).toContain("GT_TOOL_TIMEOUT_MS");
  });

  it("returns promptly when the client cancels the call", async () => {
    const ac = new AbortController();
    const pending = guardToolHandler("gt_search", never, 60_000)({}, ctxWith(ac.signal));
    ac.abort();
    const result = await pending;
    expect(result["isError"]).toBe(true);
    expect(JSON.stringify(result["content"])).toContain("cancelled");
  });

  it("exposes the call's abort signal to code running inside the handler", async () => {
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    const handler: Handler = async () => {
      seen = currentCallSignal();
      return { content: [] };
    };
    await guardToolHandler("gt_get_docs", handler, 60_000)({}, ctxWith(ac.signal));
    expect(seen?.aborted).toBe(false);
    ac.abort();
    expect(seen?.aborted).toBe(true);
    expect(currentCallSignal()).toBeUndefined();
  });

  it("passes handler errors through unchanged", async () => {
    const boom: Handler = async () => { throw new Error("boom"); };
    await expect(guardToolHandler("gt_get_docs", boom, 60_000)({}, ctxWith())).rejects.toThrow("boom");
  });
});
