import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  isExtractionAttempt,
  withNotice,
  EXTRACTION_REFUSAL,
  IP_NOTICE,
  safeguardPath,
  assertPublicUrl,
  withToolTimeout,
  generateRequestId,
} from "./guard.js";

// ── safeguardPath ──────────────────────────────────────────────────────────────

describe("withToolTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result of fn() when it resolves before the timeout", async () => {
    const fn = async () => {
      await new Promise<void>((res) => setTimeout(res, 100));
      return "success";
    };
    const promise = withToolTimeout(fn, "fallback", 5000);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("success");
  });

  it("returns the fallback when fn() takes longer than the timeout", async () => {
    const fn = async () => {
      await new Promise<void>((res) => setTimeout(res, 10_000));
      return "too slow";
    };
    const promise = withToolTimeout(fn, "fallback", 500);
    await vi.runAllTimersAsync();
    expect(await promise).toBe("fallback");
  });

  it("propagates errors thrown by fn() without returning the fallback", async () => {
    const fn = async (): Promise<string> => {
      await new Promise<void>((res) => setTimeout(res, 50));
      throw new Error("fn error");
    };
    // The timeout (5000ms) must not fire before fn() rejects at 50ms.
    // Advance only past the fn delay so the timeout never resolves.
    const promise = withToolTimeout(fn, "fallback", 5000);
    vi.advanceTimersByTime(60); // fn fires and throws; timeout not reached
    await expect(promise).rejects.toThrow("fn error");
  });
});

describe("generateRequestId", () => {
  it("returns an 8-character hex string", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});
