import { describe, it, expect, beforeEach } from "vitest";
import type { ServerContext } from "@modelcontextprotocol/server";
import { withTelemetry, getRecentOutcomes, resetTelemetry } from "./telemetry.js";
import { formatPrometheus, resetMetrics } from "./metrics.js";
import { runWithCallSignal } from "../utils/guard.js";
import { guardToolHandler } from "../server/register-tools.js";

const errorsTotal = (tool: string): string | undefined =>
  formatPrometheus().split("\n").find((l) => l.startsWith(`gt_tool_errors_total{tool="${tool}"}`));

beforeEach(() => {
  resetTelemetry();
  resetMetrics();
});

describe("withTelemetry on an aborted call", () => {
  it("records an error the moment the call signal aborts, and ignores the late finish", async () => {
    const abort = new AbortController();
    let finish = (): void => {};
    const late = new Promise<string>((resolve) => { finish = () => resolve("late"); });
    const call = runWithCallSignal(abort.signal, () => withTelemetry("gt_abort_test", () => late));

    abort.abort();
    expect(getRecentOutcomes().map((o) => o.success)).toEqual([false]);
    expect(errorsTotal("gt_abort_test")).toBe('gt_tool_errors_total{tool="gt_abort_test"} 1');

    finish();
    await call;
    expect(getRecentOutcomes()).toHaveLength(1);
  });

  it("still records success when the signal never aborts", async () => {
    const abort = new AbortController();
    await runWithCallSignal(abort.signal, () => withTelemetry("gt_ok_test", async () => "ok"));
    abort.abort();
    expect(getRecentOutcomes().map((o) => o.success)).toEqual([true]);
    expect(errorsTotal("gt_ok_test")).toBe('gt_tool_errors_total{tool="gt_ok_test"} 0');
  });

  it("counts the register-tools deadline result in gt_tool_errors_total", async () => {
    const ctx = { mcpReq: { signal: new AbortController().signal } } as unknown as ServerContext;
    const handler = guardToolHandler(
      "gt_get_docs",
      () => withTelemetry("gt_get_docs", () => new Promise<Record<string, unknown>>(() => { /* hangs */ })),
      20,
    );
    const result = await handler({}, ctx);
    expect(result["isError"]).toBe(true);
    expect(errorsTotal("gt_get_docs")).toBe('gt_tool_errors_total{tool="gt_get_docs"} 1');
  });
});
