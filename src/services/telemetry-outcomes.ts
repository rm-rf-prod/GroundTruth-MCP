/** Rolling window of tool-invocation outcomes and the counters derived from it. */

export interface InvocationOutcome {
  tool: string;
  requestId: string;
  ts: number;
  durationMs: number;
  success: boolean;
  cacheHit: boolean;
  resolved: boolean;
  error?: string;
}

const RECENT_OUTCOMES_CAP = 200;
const recentOutcomes: InvocationOutcome[] = [];

export function pushOutcome(o: InvocationOutcome): void {
  recentOutcomes.push(o);
  if (recentOutcomes.length > RECENT_OUTCOMES_CAP) {
    recentOutcomes.shift();
  }
}

/** Read-only access to the last 200 invocation outcomes — for /health endpoint */
export function getRecentOutcomes(): readonly InvocationOutcome[] {
  return recentOutcomes;
}

/** Aggregated success/resolution counters over the recent outcome window */
export function getInvocationSummary(): {
  totalCalls: number;
  successRate: number;
  resolveRate: number;
  errorRate: number;
  byTool: Record<string, { calls: number; successRate: number; resolveRate: number; p50: number; p95: number }>;
} {
  if (recentOutcomes.length === 0) {
    return { totalCalls: 0, successRate: 1, resolveRate: 1, errorRate: 0, byTool: {} };
  }

  let success = 0;
  let resolved = 0;
  const byTool = new Map<string, { calls: number; success: number; resolved: number; latencies: number[] }>();

  for (const o of recentOutcomes) {
    if (o.success) success++;
    if (o.resolved) resolved++;
    let entry = byTool.get(o.tool);
    if (!entry) {
      entry = { calls: 0, success: 0, resolved: 0, latencies: [] };
      byTool.set(o.tool, entry);
    }
    entry.calls++;
    if (o.success) entry.success++;
    if (o.resolved) entry.resolved++;
    entry.latencies.push(o.durationMs);
  }

  const byToolOut: Record<string, { calls: number; successRate: number; resolveRate: number; p50: number; p95: number }> = {};
  for (const [tool, m] of byTool.entries()) {
    const sorted = [...m.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    byToolOut[tool] = {
      calls: m.calls,
      successRate: m.calls > 0 ? +(m.success / m.calls).toFixed(3) : 1,
      resolveRate: m.calls > 0 ? +(m.resolved / m.calls).toFixed(3) : 1,
      p50,
      p95,
    };
  }

  return {
    totalCalls: recentOutcomes.length,
    successRate: +(success / recentOutcomes.length).toFixed(3),
    resolveRate: +(resolved / recentOutcomes.length).toFixed(3),
    errorRate: +(1 - success / recentOutcomes.length).toFixed(3),
    byTool: byToolOut,
  };
}

/** Reset the in-memory outcome window — used by tests */
export function resetTelemetry(): void {
  recentOutcomes.length = 0;
}
