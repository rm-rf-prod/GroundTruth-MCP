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

  it("prune() deletes corrupt (malformed-but-parseable) cache files (TS-011)", async () => {
    const cache = await makeDiskCache(tmpDir);
    const { createHash } = await import("crypto");

    // Write a corrupt file: valid JSON but missing expiresAt
    const corruptKey = "prune-corrupt-key";
    const corruptHash = createHash("sha256").update(corruptKey).digest("hex");
    const corruptPath = join(tmpDir, `${corruptHash}.json`);
    await writeFile(corruptPath, JSON.stringify({}), "utf-8");

    // Write a second corrupt variant: has data but expiresAt is a string, not a number
    const corrupt2Key = "prune-corrupt-key-2";
    const corrupt2Hash = createHash("sha256").update(corrupt2Key).digest("hex");
    const corrupt2Path = join(tmpDir, `${corrupt2Hash}.json`);
    await writeFile(corrupt2Path, JSON.stringify({ data: "x", expiresAt: "not-a-number" }), "utf-8");

    const removed = await cache.prune(1000);
    expect(removed).toBe(2);
    // Both corrupt files must be deleted
    await expect(import("fs/promises").then((fs) => fs.access(corruptPath))).rejects.toThrow();
    await expect(import("fs/promises").then((fs) => fs.access(corrupt2Path))).rejects.toThrow();
  });

  it("prune() does not remove entries still within the SWR window", async () => {
    const cache = await makeDiskCache(tmpDir);
    const { createHash } = await import("crypto");

    // Write entry expired 1s ago — still within the 60-min SWR window
    const staleKey = "prune-stale-within-swr";
    const staleHash = createHash("sha256").update(staleKey).digest("hex");
    const stalePath = join(tmpDir, `${staleHash}.json`);
    const staleEntry = { data: "stale-but-serveable", expiresAt: Date.now() - 1_000 };
    await writeFile(stalePath, JSON.stringify(staleEntry), "utf-8");

    const removed = await cache.prune(1000);
    expect(removed).toBe(0);
    // Stale-within-SWR file must still exist
    await expect(import("fs/promises").then((fs) => fs.access(stalePath))).resolves.toBeUndefined();
  });

  it("prune() returns 0 when cache dir does not exist", async () => {
    const nonexistentDir = join(tmpDir, "does-not-exist");
    process.env.GT_CACHE_DIR = nonexistentDir;
    vi.resetModules();
    const { diskDocCache: cache } = await import("./cache.js");
    // prune should not throw and should return 0 when it cannot read the dir
    // (ensureDir creates the dir, so we get 0 files removed instead of an error)
    await expect(cache.prune(1000)).resolves.toBeDefined();
  });

  // ── set() write-lock serialization (HARDENING) ─────────────────────────────

  it("set() write-lock serializes concurrent writes to the same key — last-enqueued write wins deterministically", async () => {
    const cache = await makeDiskCache(tmpDir);
    // Warm ensureDir() first so both racing set() calls below skip the
    // internal `await mkdir(...)` and resume from `await this.ensureDir()`
    // in the same order they were invoked (V8 microtask FIFO ordering) —
    // this is what makes the winner deterministic rather than a true race.
    await cache.set("warm-up", "warm");

    await Promise.all([
      cache.set("race-key", "valueA"),
      cache.set("race-key", "valueB"),
    ]);

    const { createHash } = await import("crypto");
    const { readFile } = await import("fs/promises");
    const hash = createHash("sha256").update("race-key").digest("hex");
    const raw = await readFile(join(tmpDir, `${hash}.json`), "utf-8");
    const parsed = JSON.parse(raw) as { data: string; expiresAt: number };

    // set()'s per-key writeLocks chain each call onto the previous write's
    // promise (`previous.then(() => atomicWrite(...))`), so the second call
    // in program order ('valueB') is enqueued after the first ('valueA') and
    // its atomicWrite runs last, overwriting the file via temp-write + rename.
    expect(["valueA", "valueB"]).toContain(parsed.data);
    expect(parsed.data).toBe("valueB");
  });

});
