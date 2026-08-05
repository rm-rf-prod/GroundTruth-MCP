import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitState,
  resetCircuit,
  resetAllCircuits,
  extractDomain,
  getCircuitSummary,
} from "./circuit-breaker.js";

beforeEach(() => {
  resetAllCircuits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCircuitSummary", () => {
  it("returns all zeros when no circuits exist", () => {
    const summary = getCircuitSummary();
    expect(summary).toEqual({ open: 0, halfOpen: 0, closed: 0 });
  });

  it("counts closed circuits", () => {
    recordSuccess("a.com");
    recordSuccess("b.com");
    const summary = getCircuitSummary();
    expect(summary.closed).toBe(2);
    expect(summary.open).toBe(0);
  });

  it("counts open circuits", () => {
    for (let i = 0; i < 3; i++) recordFailure("fail.com");
    const summary = getCircuitSummary();
    expect(summary.open).toBe(1);
  });
});
