/**
 * Telemetry — request lifecycle tracking, structured logs, and success/error
 * rate observability for every MCP tool invocation.
 *
 * Every tool handler should be wrapped with `withTelemetry` so every call gets:
 * - Unique request ID for log correlation
 * - Duration measurement (p50/p95 via metrics.ts)
 * - Success / error / empty-result tracking
 * - Structured log entry
 * - Stored last-failure for /health diagnostics
 *
 * The goal: every "use gt mcp" invocation produces an observable trace so we
 * can prove 100% success rate (or diagnose exactly why it dropped).
 */

import { randomBytes } from "crypto";
import { log } from "../utils/logger.js";
import { recordToolCall } from "./metrics.js";

export interface TelemetryContext {
  tool: string;
  requestId: string;
  startTime: number;
  /** Set by handler when a request resolves from cache */
  cacheHit: boolean;
  /** Set by handler when content was successfully delivered to the user */
  resolved: boolean;
  /** Optional input fingerprint for grouping retries */
  inputHash?: string;
}

export interface TelemetryResult {
  durationMs: number;
  success: boolean;
  cacheHit: boolean;
  resolved: boolean;
  error?: string;
}

interface InvocationOutcome {
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

function pushOutcome(o: InvocationOutcome): void {
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

export function generateRequestId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Open a telemetry context for a tool invocation. Pair with `endCall*`
 * exactly once. Prefer `withTelemetry` for typical handler wrapping.
 */
export function startCall(tool: string, inputHash?: string): TelemetryContext {
  const ctx: TelemetryContext = {
    tool,
    requestId: generateRequestId(),
    startTime: Date.now(),
    cacheHit: false,
    resolved: false,
  };
  if (inputHash !== undefined) ctx.inputHash = inputHash;
  log({ level: "debug", msg: "tool.start", tool, requestId: ctx.requestId });
  return ctx;
}

function finish(
  ctx: TelemetryContext,
  success: boolean,
  errorMessage?: string,
): TelemetryResult {
  const durationMs = Date.now() - ctx.startTime;
  recordToolCall(ctx.tool, durationMs, ctx.cacheHit, !success);
  const outcome: InvocationOutcome = {
    tool: ctx.tool,
    requestId: ctx.requestId,
    ts: Date.now(),
    durationMs,
    success,
    cacheHit: ctx.cacheHit,
    resolved: ctx.resolved,
  };
  if (errorMessage !== undefined) outcome.error = errorMessage;
  pushOutcome(outcome);

  const baseEntry: Record<string, unknown> = {
    level: success ? "info" : "error",
    msg: success ? "tool.end" : "tool.error",
    tool: ctx.tool,
    requestId: ctx.requestId,
    durationMs,
    cacheHit: ctx.cacheHit,
    resolved: ctx.resolved,
  };
  if (errorMessage !== undefined) baseEntry["error"] = errorMessage;
  log(baseEntry as never);
  const result: TelemetryResult = { durationMs, success, cacheHit: ctx.cacheHit, resolved: ctx.resolved };
  if (errorMessage !== undefined) result.error = errorMessage;
  return result;
}

export function endCallSuccess(ctx: TelemetryContext): TelemetryResult {
  return finish(ctx, true);
}

export function endCallError(ctx: TelemetryContext, error: unknown): TelemetryResult {
  const message = error instanceof Error ? error.message : String(error);
  return finish(ctx, false, message);
}

/**
 * Wrap a tool handler with full telemetry instrumentation.
 *
 * The handler receives the `ctx` so it can flip `ctx.cacheHit` and
 * `ctx.resolved` to communicate richer state to telemetry. Errors thrown
 * inside the handler are caught, recorded, then re-thrown so the MCP
 * protocol layer can format them. If you want a never-fail tool that
 * returns guidance text instead of throwing, use `result-guarantee.ts`.
 */
export async function withTelemetry<T>(
  tool: string,
  fn: (ctx: TelemetryContext) => Promise<T>,
  inputHash?: string,
): Promise<T> {
  const ctx = startCall(tool, inputHash);
  try {
    const result = await fn(ctx);
    endCallSuccess(ctx);
    return result;
  } catch (err) {
    endCallError(ctx, err);
    throw err;
  }
}
