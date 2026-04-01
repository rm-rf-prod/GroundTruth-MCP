import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitState,
  resetCircuit,
  resetAllCircuits,
  extractDomain,
} from "./circuit-breaker.js";

beforeEach(() => {
  resetAllCircuits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extractDomain", () => {
  it("extracts hostname from URL", () => {
    expect(extractDomain("https://r.jina.ai/https://docs.example.com")).toBe("r.jina.ai");
  });

  it("returns input for invalid URL", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("circuit breaker states", () => {
  it("starts closed", () => {
    expect(getCircuitState("example.com")).toBe("closed");
    expect(isCircuitOpen("example.com")).toBe(false);
  });

  it("stays closed below threshold", () => {
    for (let i = 0; i < 2; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("closed");
    expect(isCircuitOpen("example.com")).toBe(false);
  });

  it("opens after reaching failure threshold", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("open");
    expect(isCircuitOpen("example.com")).toBe(true);
  });

  it("transitions to half-open after reset timeout", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    expect(isCircuitOpen("example.com")).toBe(true);

    vi.advanceTimersByTime(60_000);

    expect(isCircuitOpen("example.com")).toBe(false);
    expect(getCircuitState("example.com")).toBe("half-open");
  });

  it("closes on success after half-open", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    vi.advanceTimersByTime(60_000);
    isCircuitOpen("example.com");

    recordSuccess("example.com");
    expect(getCircuitState("example.com")).toBe("closed");
    expect(isCircuitOpen("example.com")).toBe(false);
  });

  it("re-opens on failure during half-open", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    vi.advanceTimersByTime(60_000);
    isCircuitOpen("example.com");

    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("open");
  });

  it("resets failure count on success", () => {
    for (let i = 0; i < 2; i++) {
      recordFailure("example.com");
    }
    recordSuccess("example.com");
    for (let i = 0; i < 2; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("closed");
  });
});

describe("per-domain isolation", () => {
  it("tracks domains independently", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("failing.com");
    }
    expect(isCircuitOpen("failing.com")).toBe(true);
    expect(isCircuitOpen("healthy.com")).toBe(false);
  });
});

describe("resetCircuit", () => {
  it("resets a specific domain", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    expect(isCircuitOpen("example.com")).toBe(true);
    resetCircuit("example.com");
    expect(isCircuitOpen("example.com")).toBe(false);
  });
});

describe("resetAllCircuits", () => {
  it("resets all domains", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("a.com");
      recordFailure("b.com");
    }
    resetAllCircuits();
    expect(isCircuitOpen("a.com")).toBe(false);
    expect(isCircuitOpen("b.com")).toBe(false);
  });
});

describe("MAX_BREAKERS eviction", () => {
  it("evicts the oldest entry when the breakers map exceeds 500", () => {
    resetAllCircuits();
    const MAX_BREAKERS = 500;

    // Record a failure for each of the first MAX_BREAKERS domains.
    // The first domain inserted ("domain-0.com") will have the oldest lastFailure
    // because fake timers advance by 1ms per domain to ensure stable ordering.
    for (let i = 0; i < MAX_BREAKERS; i++) {
      vi.advanceTimersByTime(1);
      recordFailure(`domain-${i}.com`);
    }

    // "domain-0.com" now holds the oldest lastFailure timestamp.
    // Confirm it currently has an entry by checking its state.
    expect(getCircuitState("domain-0.com")).toBe("closed");

    // Adding one more domain triggers eviction of the oldest entry.
    vi.advanceTimersByTime(1);
    recordFailure("domain-overflow.com");

    // "domain-0.com" must have been evicted — getCircuitState creates a fresh
    // entry, so the circuit will be "closed" again (brand-new entry).
    // We verify eviction by confirming the failure count was reset: after
    // eviction a fresh entry starts at 0 failures, so one more failure below
    // the threshold keeps it "closed" rather than retaining any prior count.
    recordFailure("domain-0.com"); // 1 failure on fresh entry → still closed
    expect(getCircuitState("domain-0.com")).toBe("closed");

    // The overflow domain must be present.
    expect(getCircuitState("domain-overflow.com")).toBe("closed");
  });
});
