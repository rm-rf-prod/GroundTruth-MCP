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

describe("resetMetrics", () => {
  it("clears all recorded data", () => {
    recordToolCall("resolve", 100, false, false);
    resetMetrics();
    const summary = getMetricsSummary();
    expect(Object.keys(summary)).toHaveLength(0);
  });
});

describe("recordToolCall", () => {
  it("increments invocations on each call", () => {
    recordToolCall("resolve", 50, false, false);
    recordToolCall("resolve", 60, false, false);
    recordToolCall("resolve", 70, false, false);
    const summary = getMetricsSummary();
    expect(summary["resolve"]?.invocations).toBe(3);
  });

  it("tracks separate tools independently", () => {
    recordToolCall("resolve", 50, false, false);
    recordToolCall("docs", 100, true, false);
    const summary = getMetricsSummary();
    expect(summary["resolve"]?.invocations).toBe(1);
    expect(summary["docs"]?.invocations).toBe(1);
  });

  it("creates a new entry for a previously unseen tool", () => {
    recordToolCall("new-tool", 200, false, false);
    const summary = getMetricsSummary();
    expect(summary["new-tool"]).toBeDefined();
    expect(summary["new-tool"]?.invocations).toBe(1);
  });
});

describe("getMetricsSummary - error rate", () => {
  it("errorRate is 0 when no errors recorded", () => {
    recordToolCall("resolve", 50, false, false);
    recordToolCall("resolve", 60, false, false);
    const summary = getMetricsSummary();
    expect(summary["resolve"]?.errorRate).toBe(0);
  });

  it("errorRate is 1 when all calls errored", () => {
    recordToolCall("resolve", 50, false, true);
    recordToolCall("resolve", 60, false, true);
    const summary = getMetricsSummary();
    expect(summary["resolve"]?.errorRate).toBe(1);
  });

  it("errorRate is 0.5 when half of calls errored", () => {
    recordToolCall("resolve", 50, false, false);
    recordToolCall("resolve", 60, false, true);
    const summary = getMetricsSummary();
    expect(summary["resolve"]?.errorRate).toBe(0.5);
  });

  it("errorRate is rounded to 2 decimal places", () => {
    recordToolCall("resolve", 10, false, false);
    recordToolCall("resolve", 10, false, false);
    recordToolCall("resolve", 10, false, true);
    const summary = getMetricsSummary();
    expect(summary["resolve"]?.errorRate).toBe(0.33);
  });
});

describe("getMetricsSummary - cache hit rate", () => {
  it("cacheHitRate is 0 when all cache misses", () => {
    recordToolCall("docs", 50, false, false);
    recordToolCall("docs", 60, false, false);
    const summary = getMetricsSummary();
    expect(summary["docs"]?.cacheHitRate).toBe(0);
  });

  it("cacheHitRate is 1 when all cache hits", () => {
    recordToolCall("docs", 50, true, false);
    recordToolCall("docs", 60, true, false);
    const summary = getMetricsSummary();
    expect(summary["docs"]?.cacheHitRate).toBe(1);
  });

  it("cacheHitRate is 0.5 when half are hits", () => {
    recordToolCall("docs", 50, true, false);
    recordToolCall("docs", 60, false, false);
    const summary = getMetricsSummary();
    expect(summary["docs"]?.cacheHitRate).toBe(0.5);
  });

  it("cacheHitRate is 0 when no calls recorded", () => {
    const summary = getMetricsSummary();
    expect(summary["docs"]).toBeUndefined();
  });
});

describe("getMetricsSummary - percentiles", () => {
  it("p50 is the median latency", () => {
    recordToolCall("search", 10, false, false);
    recordToolCall("search", 20, false, false);
    recordToolCall("search", 30, false, false);
    recordToolCall("search", 40, false, false);
    recordToolCall("search", 50, false, false);
    const summary = getMetricsSummary();
    expect(summary["search"]?.p50).toBe(30);
  });

  it("p95 is the 95th percentile latency", () => {
    for (let i = 1; i <= 20; i++) {
      recordToolCall("search", i * 10, false, false);
    }
    const summary = getMetricsSummary();
    expect(summary["search"]?.p95).toBe(190);
  });

  it("p50 and p95 are 0 for a tool with no calls", () => {
    resetMetrics();
    const summary = getMetricsSummary();
    expect(summary["nonexistent"]).toBeUndefined();
  });

  it("p50 equals the single value when only one call recorded", () => {
    recordToolCall("solo", 42, false, false);
    const summary = getMetricsSummary();
    expect(summary["solo"]?.p50).toBe(42);
    expect(summary["solo"]?.p95).toBe(42);
  });

  it("p50 and p95 are computed from sorted latencies", () => {
    const latencies = [100, 10, 50, 80, 30];
    for (const ms of latencies) {
      recordToolCall("mixed", ms, false, false);
    }
    const summary = getMetricsSummary();
    expect(summary["mixed"]?.p50).toBe(50);
    expect(summary["mixed"]?.p95).toBe(100);
  });
});

describe("ring buffer cap at 100 latencies", () => {
  it("does not retain more than 100 latencies", () => {
    for (let i = 0; i < 150; i++) {
      recordToolCall("ring", i, false, false);
    }
    const summary = getMetricsSummary();
    expect(summary["ring"]?.invocations).toBe(150);
    expect(summary["ring"]?.p50).toBeGreaterThanOrEqual(50);
  });

  it("p95 reflects only the most recent 100 samples after overflow", () => {
    for (let i = 0; i < 50; i++) {
      recordToolCall("buf", 1, false, false);
    }
    for (let i = 0; i < 100; i++) {
      recordToolCall("buf", 999, false, false);
    }
    const summary = getMetricsSummary();
    expect(summary["buf"]?.p95).toBe(999);
  });
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
