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
