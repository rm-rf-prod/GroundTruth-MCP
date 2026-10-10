import { SERVER_VERSION } from "../constants.js";

interface ToolMetrics {
  invocations: number;
  totalMs: number;
  errors: number;
  /** Calls that returned without throwing but delivered no content (soft failures). */
  unresolved: number;
  cacheHits: number;
  cacheMisses: number;
  latencies: number[];
  /** Cumulative counts per DURATION_BUCKETS_S entry, Prometheus-style. */
  buckets: number[];
}

const RING_SIZE = 100;
const DURATION_BUCKETS_S = [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60];
const metricsStore = new Map<string, ToolMetrics>();
const startTime = Date.now();

function getOrCreate(tool: string): ToolMetrics {
  let m = metricsStore.get(tool);
  if (!m) {
    m = { invocations: 0, totalMs: 0, errors: 0, unresolved: 0, cacheHits: 0, cacheMisses: 0, latencies: [], buckets: DURATION_BUCKETS_S.map(() => 0) };
    metricsStore.set(tool, m);
  }
  return m;
}

export function recordToolCall(tool: string, durationMs: number, cacheHit: boolean, error: boolean, resolved = true): void {
  const m = getOrCreate(tool);
  m.invocations++;
  m.totalMs += durationMs;
  if (error) m.errors++;
  else if (!resolved) m.unresolved++;
  const seconds = durationMs / 1000;
  DURATION_BUCKETS_S.forEach((le, i) => {
    if (seconds <= le) m.buckets[i] = (m.buckets[i] ?? 0) + 1;
  });
  if (cacheHit) m.cacheHits++;
  else m.cacheMisses++;
  m.latencies.push(durationMs);
  if (m.latencies.length > RING_SIZE) m.latencies.shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export interface ToolMetricsSummary {
  invocations: number;
  p50: number;
  p95: number;
  errorRate: number;
  cacheHitRate: number;
}

export function getMetricsSummary(): Record<string, ToolMetricsSummary> {
  const result: Record<string, ToolMetricsSummary> = {};
  for (const [tool, m] of metricsStore) {
    const sorted = [...m.latencies].sort((a, b) => a - b);
    const totalCacheOps = m.cacheHits + m.cacheMisses;
    result[tool] = {
      invocations: m.invocations,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      errorRate: m.invocations > 0 ? Math.round((m.errors / m.invocations) * 100) / 100 : 0,
      cacheHitRate: totalCacheOps > 0 ? Math.round((m.cacheHits / totalCacheOps) * 100) / 100 : 0,
    };
  }
  return result;
}

export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

export function formatPrometheus(): string {
  const lines: string[] = [];
  const summary = getMetricsSummary();

  lines.push("# HELP gt_tool_invocations_total Total invocations per tool");
  lines.push("# TYPE gt_tool_invocations_total counter");
  for (const [tool, m] of Object.entries(summary)) {
    lines.push(`gt_tool_invocations_total{tool="${tool}"} ${m.invocations}`);
  }

  lines.push("# HELP gt_tool_errors_total Total errors per tool");
  lines.push("# TYPE gt_tool_errors_total counter");
  for (const tool of Object.keys(summary)) {
    // Emit the raw integer error count — reconstructing it from the rounded
    // errorRate introduced off-by-one drift at realistic invocation counts.
    lines.push(`gt_tool_errors_total{tool="${tool}"} ${metricsStore.get(tool)?.errors ?? 0}`);
  }

  lines.push("# HELP gt_tool_unresolved_total Calls that returned without error but delivered no content");
  lines.push("# TYPE gt_tool_unresolved_total counter");
  for (const [tool, m] of metricsStore) {
    lines.push(`gt_tool_unresolved_total{tool="${tool}"} ${m.unresolved}`);
  }

  // The p50/p95 gauges below cover only the last RING_SIZE calls per replica; the
  // histogram aggregates across replicas and time windows (histogram_quantile).
  lines.push("# HELP gt_tool_duration_seconds Tool call duration in seconds");
  lines.push("# TYPE gt_tool_duration_seconds histogram");
  for (const [tool, m] of metricsStore) {
    DURATION_BUCKETS_S.forEach((le, i) => {
      lines.push(`gt_tool_duration_seconds_bucket{tool="${tool}",le="${le}"} ${m.buckets[i]}`);
    });
    lines.push(`gt_tool_duration_seconds_bucket{tool="${tool}",le="+Inf"} ${m.invocations}`);
    lines.push(`gt_tool_duration_seconds_sum{tool="${tool}"} ${m.totalMs / 1000}`);
    lines.push(`gt_tool_duration_seconds_count{tool="${tool}"} ${m.invocations}`);
  }

  lines.push("# HELP gt_tool_latency_p50_ms Median latency per tool");
  lines.push("# TYPE gt_tool_latency_p50_ms gauge");
  for (const [tool, m] of Object.entries(summary)) {
    lines.push(`gt_tool_latency_p50_ms{tool="${tool}"} ${m.p50}`);
  }

  lines.push("# HELP gt_tool_latency_p95_ms 95th percentile latency per tool");
  lines.push("# TYPE gt_tool_latency_p95_ms gauge");
  for (const [tool, m] of Object.entries(summary)) {
    lines.push(`gt_tool_latency_p95_ms{tool="${tool}"} ${m.p95}`);
  }

  lines.push("# HELP gt_tool_cache_hit_rate Cache hit rate per tool");
  lines.push("# TYPE gt_tool_cache_hit_rate gauge");
  for (const [tool, m] of Object.entries(summary)) {
    lines.push(`gt_tool_cache_hit_rate{tool="${tool}"} ${m.cacheHitRate}`);
  }

  lines.push(`# HELP gt_uptime_seconds Server uptime in seconds`);
  lines.push(`# TYPE gt_uptime_seconds gauge`);
  lines.push(`gt_uptime_seconds ${getUptimeSeconds()}`);

  lines.push("# HELP gt_build_info Server build information");
  lines.push("# TYPE gt_build_info gauge");
  lines.push(`gt_build_info{version="${SERVER_VERSION}"} 1`);

  return lines.join("\n") + "\n";
}

export function resetMetrics(): void {
  metricsStore.clear();
}
