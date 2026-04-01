interface ToolMetrics {
  invocations: number;
  totalMs: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
  latencies: number[];
}

const RING_SIZE = 100;
const metricsStore = new Map<string, ToolMetrics>();
const startTime = Date.now();

function getOrCreate(tool: string): ToolMetrics {
  let m = metricsStore.get(tool);
  if (!m) {
    m = { invocations: 0, totalMs: 0, errors: 0, cacheHits: 0, cacheMisses: 0, latencies: [] };
    metricsStore.set(tool, m);
  }
  return m;
}

export function recordToolCall(tool: string, durationMs: number, cacheHit: boolean, error: boolean): void {
  const m = getOrCreate(tool);
  m.invocations++;
  m.totalMs += durationMs;
  if (error) m.errors++;
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
  for (const [tool, m] of Object.entries(summary)) {
    lines.push(`gt_tool_errors_total{tool="${tool}"} ${Math.round(m.errorRate * (metricsStore.get(tool)?.invocations ?? 0))}`);
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

  return lines.join("\n") + "\n";
}

export function resetMetrics(): void {
  metricsStore.clear();
}
