import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// We import the class — not the shared instances — so tests are isolated
// Re-import per test by resetting modules where needed

// ── LRUCache ───────────────────────────────────────────────────────────────────

describe("LRUCache", () => {
  // Access via the shared module (LRUCache is not exported directly; test via docCache/resolveCache)
  // We test the exported instances since they expose the full interface

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("stores and retrieves a value", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("key1", "value1");
    expect(docCache.get("key1")).toBe("value1");
  });

  it("returns undefined for a missing key", async () => {
    const { docCache } = await import("./cache.js");
    expect(docCache.get("nonexistent-key-xyz")).toBeUndefined();
  });

  it("returns stale data within SWR window then evicts after", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("expiring", "value", 1000); // 1 second TTL
    expect(docCache.get("expiring")).toBe("value");
    vi.advanceTimersByTime(1001);
    expect(docCache.get("expiring")).toBe("value"); // stale-while-revalidate
    vi.advanceTimersByTime(60 * 60 * 1000); // past SWR window
    expect(docCache.get("expiring")).toBeUndefined();
  });

  it("has() returns true for live entry", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("alive", "data", 5000);
    expect(docCache.has("alive")).toBe(true);
  });

  it("has() returns true for stale entry within SWR window", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("dead", "data", 500);
    vi.advanceTimersByTime(501);
    expect(docCache.has("dead")).toBe(true); // stale but within SWR window
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(docCache.has("dead")).toBe(false); // past SWR window
  });

  it("has() returns false for missing key", async () => {
    const { docCache } = await import("./cache.js");
    expect(docCache.has("missing-key-abc")).toBe(false);
  });

  it("clear() removes all entries", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("a", "1");
    docCache.set("b", "2");
    docCache.clear();
    expect(docCache.get("a")).toBeUndefined();
    expect(docCache.get("b")).toBeUndefined();
  });

  it("size() reflects current live entry count", async () => {
    vi.resetModules(); // fresh instance with no prior entries
    const { docCache } = await import("./cache.js");
    const before = docCache.size();
    docCache.set("sz1", "x");
    docCache.set("sz2", "y");
    expect(docCache.size()).toBe(before + 2);
  });

  it("size() does not count fully expired entries (past SWR window)", async () => {
    vi.resetModules();
    const { docCache } = await import("./cache.js");
    docCache.clear();
    docCache.set("exp", "v", 100);
    expect(docCache.size()).toBe(1);
    vi.advanceTimersByTime(101);
    docCache.get("exp"); // stale but still in SWR window — not evicted
    expect(docCache.size()).toBe(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    docCache.get("exp"); // now past SWR — evicted
    expect(docCache.size()).toBe(0);
  });

  it("overwrites existing key with new value", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("dup", "first");
    docCache.set("dup", "second");
    expect(docCache.get("dup")).toBe("second");
  });

  it("uses custom TTL when provided", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("short", "v", 200);
    vi.advanceTimersByTime(199);
    expect(docCache.get("short")).toBe("v"); // still fresh
    vi.advanceTimersByTime(2);
    expect(docCache.get("short")).toBe("v"); // stale but in SWR window
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(docCache.get("short")).toBeUndefined(); // past SWR
  });

  it("evicts the LRU (first inserted) entry when store reaches maxSize (200)", async () => {
    vi.resetModules();
    const { docCache } = await import("./cache.js");
    docCache.clear();
    // Fill to exactly maxSize (200) — key 0 is the LRU (first inserted, never accessed)
    for (let i = 0; i < 200; i++) {
      docCache.set(`lru-evict-${i}`, `v${i}`);
    }
    expect(docCache.size()).toBe(200);
    // Adding the 201st entry triggers eviction of the LRU (lru-evict-0)
    docCache.set("lru-evict-200", "trigger");
    // lru-evict-0 must be gone
    expect(docCache.get("lru-evict-0")).toBeUndefined();
    // New entry must be present
    expect(docCache.get("lru-evict-200")).toBe("trigger");
    // Cache size stays at maxSize
    expect(docCache.size()).toBe(200);
  });
});

// ── DiskCache ─────────────────────────────────────────────────────────────────

describe("DiskCache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gt-mcp-diskcache-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  async function makeDiskCache(dir: string) {
    // Import DiskCache via a workaround — it's not exported; use the constructor via internal import
    vi.resetModules();
    // We need to test DiskCache directly — it's exported from the module in the source
    // but via the class. We'll instantiate it via the module's class export.
    const mod = await import("./cache.js");
    // DiskCache is not exported from cache.ts — test behaviour through the exported diskDocCache
    // by temporarily changing DISK_CACHE_DIR. Instead, we create a direct module-level instance
    // using the constructor exposed in the module. Since DiskCache is not exported, we test
    // it via the module internals by creating a new instance the same way the module does.
    // The cleanest approach: re-export via a test helper — but since we can't modify source,
    // we test through the exported diskDocCache after patching the env variable.
    // Use DiskCache via dynamic module with patched GT_CACHE_DIR
    process.env.GT_CACHE_DIR = dir;
    vi.resetModules();
    const { diskDocCache: cache } = await import("./cache.js");
    return cache;
  }

  it("stores and retrieves a string value", async () => {
    const cache = await makeDiskCache(tmpDir);
    await cache.set("test-key", "test-value");
    const result = await cache.get("test-key");
    expect(result).toBe("test-value");
  });

  it("returns undefined for a missing key", async () => {
    const cache = await makeDiskCache(tmpDir);
    const result = await cache.get("this-key-does-not-exist");
    expect(result).toBeUndefined();
  });

  it("has() returns true for a stored non-expired entry", async () => {
    const cache = await makeDiskCache(tmpDir);
    await cache.set("present", "data");
    expect(await cache.has("present")).toBe(true);
  });

  it("has() returns false for a missing key", async () => {
    const cache = await makeDiskCache(tmpDir);
    expect(await cache.has("absent-key")).toBe(false);
  });

  it("has() returns true for stale entry within SWR and false after", async () => {
    const cache = await makeDiskCache(tmpDir);
    const recentExpiry = Date.now() - 1000; // 1s past TTL — within SWR
    const entry = { data: "old value", expiresAt: recentExpiry };
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update("expire-has-test").digest("hex");
    await writeFile(join(tmpDir, `${hash}.json`), JSON.stringify(entry), "utf-8");
    expect(await cache.has("expire-has-test")).toBe(true); // stale but within SWR

    const oldExpiry = Date.now() - (61 * 60 * 1000); // 61min past — beyond SWR
    const entry2 = { data: "dead", expiresAt: oldExpiry };
    const hash2 = createHash("sha256").update("dead-has-test").digest("hex");
    await writeFile(join(tmpDir, `${hash2}.json`), JSON.stringify(entry2), "utf-8");
    expect(await cache.has("dead-has-test")).toBe(false);
  });

  it("returns stale data within SWR window and undefined after", async () => {
    vi.useFakeTimers();
    const cache = await makeDiskCache(tmpDir);
    const recentExpiry = Date.now() - 1000; // expired 1s ago — within SWR window
    const entry1 = { data: "stale value", expiresAt: recentExpiry };
    const { createHash } = await import("crypto");
    const hash1 = createHash("sha256").update("stale-key").digest("hex");
    await writeFile(join(tmpDir, `${hash1}.json`), JSON.stringify(entry1), "utf-8");
    const staleResult = await cache.get("stale-key");
    expect(staleResult).toBe("stale value"); // SWR returns stale data

    const oldExpiry = Date.now() - (61 * 60 * 1000); // expired 61min ago — past SWR
    const entry2 = { data: "dead value", expiresAt: oldExpiry };
    const hash2 = createHash("sha256").update("dead-key").digest("hex");
    await writeFile(join(tmpDir, `${hash2}.json`), JSON.stringify(entry2), "utf-8");
    const deadResult = await cache.get("dead-key");
    expect(deadResult).toBeUndefined();
    vi.useRealTimers();
  });

  it("persists data across separate cache instances (different requires)", async () => {
    const c1 = await makeDiskCache(tmpDir);
    await c1.set("persisted", "cross-session value");

    // Simulate a new session by re-importing
    vi.resetModules();
    process.env.GT_CACHE_DIR = tmpDir;
    const { diskDocCache: c2 } = await import("./cache.js");
    const result = await c2.get("persisted");
    expect(result).toBe("cross-session value");
  });

  it("handles I/O errors gracefully (returns undefined, does not throw)", async () => {
    const cache = await makeDiskCache("/nonexistent/path/that/cannot/be/created");
    // Should not throw — silently returns undefined
    const result = await cache.get("any-key");
    expect(result).toBeUndefined();
    // set should also not throw
    await expect(cache.set("any-key", "value")).resolves.toBeUndefined();
  });

  afterEach(() => {
    delete process.env.GT_CACHE_DIR;
  });
});

// ── llmsProbeCache ─────────────────────────────────────────────────────────────

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
