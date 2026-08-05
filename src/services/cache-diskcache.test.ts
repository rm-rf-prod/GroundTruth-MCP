import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// We import the class — not the shared instances — so tests are isolated
// Re-import per test by resetting modules where needed

// ── LRUCache ───────────────────────────────────────────────────────────────────

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

  afterEach(() => {
    delete process.env.GT_CACHE_DIR;
  });

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

  // ── prune() ───────────────────────────────────────────────────────────────────

  it("prune() removes expired-past-SWR entries and returns correct removed count", async () => {
    const cache = await makeDiskCache(tmpDir);
    const { createHash } = await import("crypto");

    // Write one fresh entry (should survive)
    const freshKey = "prune-fresh-key";
    const freshHash = createHash("sha256").update(freshKey).digest("hex");
    const freshEntry = { data: "fresh", expiresAt: Date.now() + 60_000 };
    await writeFile(join(tmpDir, `${freshHash}.json`), JSON.stringify(freshEntry), "utf-8");

    // Write one expired-beyond-SWR entry (should be deleted)
    const deadKey = "prune-dead-key";
    const deadHash = createHash("sha256").update(deadKey).digest("hex");
    const deadEntry = { data: "dead", expiresAt: Date.now() - (61 * 60 * 1000) };
    await writeFile(join(tmpDir, `${deadHash}.json`), JSON.stringify(deadEntry), "utf-8");

    const removed = await cache.prune(1000);
    expect(removed).toBe(1);
    // Dead file must be gone
    await expect(import("fs/promises").then((fs) => fs.access(join(tmpDir, `${deadHash}.json`)))).rejects.toThrow();
    // Fresh file must still exist
    await expect(import("fs/promises").then((fs) => fs.access(join(tmpDir, `${freshHash}.json`)))).resolves.toBeUndefined();
  });

  it("prune() triggers LRU eviction when remaining file count exceeds maxEntries (REL-007)", async () => {
    const cache = await makeDiskCache(tmpDir);
    const { createHash } = await import("crypto");
    const maxEntries = 3;
    // Seed maxEntries + 2 fresh (non-expired) files
    const totalFiles = maxEntries + 2;
    const hashes: string[] = [];
    for (let i = 0; i < totalFiles; i++) {
      const key = `lru-evict-test-${i}`;
      const hash = createHash("sha256").update(key).digest("hex");
      hashes.push(hash);
      const entry = { data: `value-${i}`, expiresAt: Date.now() + 60_000, mtime: i };
      await writeFile(join(tmpDir, `${hash}.json`), JSON.stringify(entry), "utf-8");
      // Brief stagger so mtime ordering is deterministic
      await new Promise((r) => setTimeout(r, 5));
    }

    const removed = await cache.prune(maxEntries);
    // Must have evicted 2 files to bring count down to maxEntries
    expect(removed).toBe(2);
    // Total JSON files on disk must be <= maxEntries
    const { readdir: rd } = await import("fs/promises");
    const remaining = (await rd(tmpDir)).filter((f) => f.endsWith(".json"));
    expect(remaining.length).toBeLessThanOrEqual(maxEntries);
  });

});
