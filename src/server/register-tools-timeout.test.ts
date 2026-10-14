import { describe, it, expect, afterEach, vi } from "vitest";
import type { ServerContext } from "@modelcontextprotocol/server";

type Result = Record<string, unknown>;
const never = () => new Promise<Result>(() => { /* never settles */ });
const ctx = () => ({ mcpReq: { signal: new AbortController().signal } }) as unknown as ServerContext;

async function loadWithTimeout(ms: string) {
  vi.resetModules();
  vi.stubEnv("GT_TOOL_TIMEOUT_MS", ms);
  return import("./register-tools.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GT_TOOL_TIMEOUT_MS enforcement", () => {
  it("bounds gt_get_docs, gt_best_practices and gt_search by the configured value", async () => {
    const { guardToolHandler } = await loadWithTimeout("40");
    for (const name of ["gt_get_docs", "gt_best_practices", "gt_search"]) {
      const result = await guardToolHandler(name, never)({}, ctx());
      expect(result["isError"], name).toBe(true);
      expect(JSON.stringify(result["content"]), name).toContain("40 ms");
    }
  }, 15000);

  it("leaves self-timed tools to their own tailored timeout fallback", async () => {
    const { guardToolHandler } = await loadWithTimeout("40");
    const outcome = await Promise.race([
      guardToolHandler("gt_audit", never)({}, ctx()).then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("still running"), 200)),
    ]);
    expect(outcome).toBe("still running");
  });
});
