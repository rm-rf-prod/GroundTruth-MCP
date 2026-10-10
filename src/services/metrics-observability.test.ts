import { describe, it, expect, beforeEach } from "vitest";
import { recordToolCall, formatPrometheus, resetMetrics } from "./metrics.js";
import { withTelemetry } from "./telemetry.js";
import { SERVER_VERSION } from "../constants.js";

beforeEach(() => {
  resetMetrics();
});

function line(output: string, prefix: string): string | undefined {
  return output.split("\n").find((l) => l.startsWith(prefix));
}

describe("gt_tool_duration_seconds histogram", () => {
  it("emits cumulative buckets, +Inf, sum and count in seconds", () => {
    recordToolCall("docs", 30, false, false);
    recordToolCall("docs", 2_000, false, false);
    const out = formatPrometheus();

    expect(out).toContain("# TYPE gt_tool_duration_seconds histogram");
    expect(line(out, 'gt_tool_duration_seconds_bucket{tool="docs",le="0.01"}')).toMatch(/ 0$/);
    expect(line(out, 'gt_tool_duration_seconds_bucket{tool="docs",le="0.05"}')).toMatch(/ 1$/);
    expect(line(out, 'gt_tool_duration_seconds_bucket{tool="docs",le="5"}')).toMatch(/ 2$/);
    expect(line(out, 'gt_tool_duration_seconds_bucket{tool="docs",le="+Inf"}')).toMatch(/ 2$/);
    expect(line(out, 'gt_tool_duration_seconds_sum{tool="docs"}')).toMatch(/ 2\.03$/);
    expect(line(out, 'gt_tool_duration_seconds_count{tool="docs"}')).toMatch(/ 2$/);
  });

  it("counts calls slower than the last bucket only in +Inf", () => {
    recordToolCall("audit", 90_000, false, false);
    const out = formatPrometheus();
    expect(line(out, 'gt_tool_duration_seconds_bucket{tool="audit",le="60"}')).toMatch(/ 0$/);
    expect(line(out, 'gt_tool_duration_seconds_bucket{tool="audit",le="+Inf"}')).toMatch(/ 1$/);
  });
});

describe("gt_tool_unresolved_total", () => {
  it("counts successful calls that delivered no content, not thrown errors", () => {
    recordToolCall("docs", 10, false, false, false);
    recordToolCall("docs", 10, false, false, true);
    recordToolCall("docs", 10, false, true, false);
    const out = formatPrometheus();
    expect(out).toContain("# TYPE gt_tool_unresolved_total counter");
    expect(line(out, 'gt_tool_unresolved_total{tool="docs"}')).toMatch(/ 1$/);
  });

  it("is fed by withTelemetry from ctx.resolved", async () => {
    await withTelemetry("gt_get_docs", async (ctx) => {
      ctx.resolved = false;
    });
    await withTelemetry("gt_get_docs", async (ctx) => {
      ctx.resolved = true;
    });
    expect(line(formatPrometheus(), 'gt_tool_unresolved_total{tool="gt_get_docs"}')).toMatch(/ 1$/);
  });
});

describe("gt_build_info", () => {
  it("exposes the server version as a constant-1 gauge", () => {
    const out = formatPrometheus();
    expect(out).toContain("# TYPE gt_build_info gauge");
    expect(out).toContain(`gt_build_info{version="${SERVER_VERSION}"} 1`);
  });
});
