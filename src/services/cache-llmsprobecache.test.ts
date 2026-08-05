import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// We import the class — not the shared instances — so tests are isolated
// Re-import per test by resetting modules where needed

// ── LRUCache ───────────────────────────────────────────────────────────────────

describe("llmsProbeCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("is exported and functional", async () => {
    const { llmsProbeCache } = await import("./cache.js");
    expect(llmsProbeCache).toBeDefined();
    expect(typeof llmsProbeCache.get).toBe("function");
    expect(typeof llmsProbeCache.set).toBe("function");
  });

  it("stores and retrieves llms probe data with both URLs", async () => {
    const { llmsProbeCache } = await import("./cache.js");
    const probeData = { llmsTxtUrl: "https://example.com/llms.txt", llmsFullTxtUrl: "https://example.com/llms-full.txt" };
    llmsProbeCache.set("llms-probe:https://example.com", probeData);
    const result = llmsProbeCache.get("llms-probe:https://example.com");
    expect(result).toEqual(probeData);
  });

  it("stores and retrieves llms probe data with only llmsTxtUrl", async () => {
    const { llmsProbeCache } = await import("./cache.js");
    const probeData = { llmsTxtUrl: "https://docs.example.com/llms.txt" };
    llmsProbeCache.set("llms-probe:https://docs.example.com", probeData);
    const result = llmsProbeCache.get("llms-probe:https://docs.example.com");
    expect(result).toEqual(probeData);
  });

  it("stores and retrieves empty probe result (no llms.txt found)", async () => {
    const { llmsProbeCache } = await import("./cache.js");
    const probeData = {};
    llmsProbeCache.set("llms-probe:https://no-llms.example.com", probeData);
    const result = llmsProbeCache.get("llms-probe:https://no-llms.example.com");
    expect(result).toEqual({});
  });

  it("returns undefined for a missing key", async () => {
    const { llmsProbeCache } = await import("./cache.js");
    expect(llmsProbeCache.get("llms-probe:https://never-set.example.com")).toBeUndefined();
  });
});
