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
    for (let i = 0; i < 4; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("closed");
    expect(isCircuitOpen("example.com")).toBe(false);
  });

  it("opens after reaching failure threshold", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("open");
    expect(isCircuitOpen("example.com")).toBe(true);
  });

  it("transitions to half-open after reset timeout", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("example.com");
    }
    expect(isCircuitOpen("example.com")).toBe(true);

    vi.advanceTimersByTime(30_000);

    expect(isCircuitOpen("example.com")).toBe(false);
    expect(getCircuitState("example.com")).toBe("half-open");
  });

  it("closes on success after half-open", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("example.com");
    }
    vi.advanceTimersByTime(30_000);
    isCircuitOpen("example.com");

    recordSuccess("example.com");
    expect(getCircuitState("example.com")).toBe("closed");
    expect(isCircuitOpen("example.com")).toBe(false);
  });

  it("re-opens on failure during half-open", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("example.com");
    }
    vi.advanceTimersByTime(30_000);
    isCircuitOpen("example.com");

    for (let i = 0; i < 5; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("open");
  });

  it("resets failure count on success", () => {
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    recordSuccess("example.com");
    for (let i = 0; i < 3; i++) {
      recordFailure("example.com");
    }
    expect(getCircuitState("example.com")).toBe("closed");
  });
});

describe("per-domain isolation", () => {
  it("tracks domains independently", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("failing.com");
    }
    expect(isCircuitOpen("failing.com")).toBe(true);
    expect(isCircuitOpen("healthy.com")).toBe(false);
  });
});

describe("resetCircuit", () => {
  it("resets a specific domain", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("example.com");
    }
    expect(isCircuitOpen("example.com")).toBe(true);
    resetCircuit("example.com");
    expect(isCircuitOpen("example.com")).toBe(false);
  });
});

describe("resetAllCircuits", () => {
  it("resets all domains", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure("a.com");
      recordFailure("b.com");
    }
    resetAllCircuits();
    expect(isCircuitOpen("a.com")).toBe(false);
    expect(isCircuitOpen("b.com")).toBe(false);
  });
});
