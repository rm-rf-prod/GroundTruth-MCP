import { describe, it, expect, beforeEach } from "vitest";
import {
  recordToolCall,
  getMetricsSummary,
  formatPrometheus,
  resetMetrics,
  getUptimeSeconds,
} from "./metrics.js";

beforeEach(() => {
  resetMetrics();
});

describe("formatPrometheus", () => {
  it("returns a non-empty string", () => {
    recordToolCall("resolve", 50, false, false);
    const output = formatPrometheus();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("ends with a newline", () => {
    recordToolCall("resolve", 50, false, false);
    const output = formatPrometheus();
    expect(output.endsWith("\n")).toBe(true);
  });

  it("includes HELP and TYPE lines for invocations counter", () => {
    recordToolCall("resolve", 50, false, false);
    const output = formatPrometheus();
    expect(output).toContain("# HELP gt_tool_invocations_total");
    expect(output).toContain("# TYPE gt_tool_invocations_total counter");
  });

  it("includes invocation count for recorded tool", () => {
    recordToolCall("docs", 100, false, false);
    recordToolCall("docs", 200, false, false);
    const output = formatPrometheus();
    expect(output).toContain('gt_tool_invocations_total{tool="docs"} 2');
  });

  it("includes p50 gauge line for recorded tool", () => {
    recordToolCall("resolve", 100, false, false);
    const output = formatPrometheus();
    expect(output).toContain("# HELP gt_tool_latency_p50_ms");
    expect(output).toContain("# TYPE gt_tool_latency_p50_ms gauge");
    expect(output).toContain('gt_tool_latency_p50_ms{tool="resolve"}');
  });

  it("includes p95 gauge line for recorded tool", () => {
    recordToolCall("resolve", 100, false, false);
    const output = formatPrometheus();
    expect(output).toContain("# HELP gt_tool_latency_p95_ms");
    expect(output).toContain('gt_tool_latency_p95_ms{tool="resolve"}');
  });

  it("includes cache hit rate gauge", () => {
    recordToolCall("search", 80, true, false);
    const output = formatPrometheus();
    expect(output).toContain("# HELP gt_tool_cache_hit_rate");
    expect(output).toContain("# TYPE gt_tool_cache_hit_rate gauge");
    expect(output).toContain('gt_tool_cache_hit_rate{tool="search"}');
  });

  it("includes uptime gauge", () => {
    const output = formatPrometheus();
    expect(output).toContain("# HELP gt_uptime_seconds");
    expect(output).toContain("# TYPE gt_uptime_seconds gauge");
    expect(output).toContain("gt_uptime_seconds ");
  });

  it("produces valid Prometheus metric lines (no label syntax errors)", () => {
    recordToolCall("audit", 150, false, false);
    const output = formatPrometheus();
    const metricLines = output
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    for (const line of metricLines) {
      expect(line).toMatch(/^[a-z_][a-z_0-9]*(\{[^}]+\})? \S+$/);
    }
  });

  it("includes errors counter section", () => {
    recordToolCall("resolve", 50, false, true);
    const output = formatPrometheus();
    expect(output).toContain("# HELP gt_tool_errors_total");
    expect(output).toContain("# TYPE gt_tool_errors_total counter");
  });

  it("multiple tools all appear in output", () => {
    recordToolCall("resolve", 50, false, false);
    recordToolCall("docs", 100, true, false);
    recordToolCall("search", 75, false, false);
    const output = formatPrometheus();
    expect(output).toContain('"resolve"');
    expect(output).toContain('"docs"');
    expect(output).toContain('"search"');
  });
});

describe("getUptimeSeconds", () => {
  it("returns a non-negative number", () => {
    expect(getUptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  it("returns a whole number", () => {
    const uptime = getUptimeSeconds();
    expect(Number.isInteger(uptime)).toBe(true);
  });
});
