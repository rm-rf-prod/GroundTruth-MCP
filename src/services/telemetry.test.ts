import { describe, it, expect, beforeEach } from "vitest";
import {
  startCall,
  endCallSuccess,
  endCallError,
  withTelemetry,
  getInvocationSummary,
  getRecentOutcomes,
  resetTelemetry,
  generateRequestId,
} from "./telemetry.js";

describe("telemetry", () => {
  beforeEach(() => {
    resetTelemetry();
  });

  it("generateRequestId returns 8-char hex", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    const id2 = generateRequestId();
    expect(id).not.toBe(id2);
  });

  it("startCall returns a context with unique requestId", () => {
    const a = startCall("gt_test");
    const b = startCall("gt_test");
    expect(a.tool).toBe("gt_test");
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.cacheHit).toBe(false);
    expect(a.resolved).toBe(false);
  });

  it("endCallSuccess records a successful outcome", () => {
    const ctx = startCall("gt_test");
    ctx.resolved = true;
    const result = endCallSuccess(ctx);
    expect(result.success).toBe(true);
    expect(result.resolved).toBe(true);
    const outcomes = getRecentOutcomes();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.tool).toBe("gt_test");
    expect(outcomes[0]?.success).toBe(true);
  });

  it("endCallError records a failure with the error message", () => {
    const ctx = startCall("gt_test");
    const result = endCallError(ctx, new Error("boom"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    const outcomes = getRecentOutcomes();
    expect(outcomes[0]?.error).toBe("boom");
  });

  it("getInvocationSummary computes successRate and per-tool stats", () => {
    const c1 = startCall("gt_a");
    c1.resolved = true;
    endCallSuccess(c1);

    const c2 = startCall("gt_a");
    endCallError(c2, new Error("fail"));

    const c3 = startCall("gt_b");
    c3.resolved = true;
    endCallSuccess(c3);

    const summary = getInvocationSummary();
    expect(summary.totalCalls).toBe(3);
    expect(summary.successRate).toBeCloseTo(2 / 3, 2);
    expect(summary.byTool["gt_a"]?.calls).toBe(2);
    expect(summary.byTool["gt_a"]?.successRate).toBeCloseTo(0.5, 2);
    expect(summary.byTool["gt_b"]?.successRate).toBe(1);
  });

  it("withTelemetry wraps handler and records success", async () => {
    const out = await withTelemetry("gt_wrap", async (ctx) => {
      ctx.resolved = true;
      return "ok";
    });
    expect(out).toBe("ok");
    const outcomes = getRecentOutcomes();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.tool).toBe("gt_wrap");
    expect(outcomes[0]?.success).toBe(true);
    expect(outcomes[0]?.resolved).toBe(true);
  });

  it("withTelemetry records failure on throw and re-throws", async () => {
    await expect(
      withTelemetry("gt_wrap_fail", async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    const outcomes = getRecentOutcomes();
    expect(outcomes[0]?.success).toBe(false);
    expect(outcomes[0]?.error).toBe("kaboom");
  });

  it("trims recent outcomes to the cap (200)", () => {
    for (let i = 0; i < 250; i++) {
      const c = startCall("gt_fill");
      c.resolved = true;
      endCallSuccess(c);
    }
    expect(getRecentOutcomes().length).toBe(200);
  });

  it("getInvocationSummary on empty store returns default success", () => {
    const s = getInvocationSummary();
    expect(s.totalCalls).toBe(0);
    expect(s.successRate).toBe(1);
    expect(s.errorRate).toBe(0);
  });
});
