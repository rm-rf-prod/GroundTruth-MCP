import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache } from "../services/disk-cache.js";

const originalSet = DiskCache.prototype.set;
const { flushDiskWrites } = await import("./flush.js");

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "gt-flush-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("flushDiskWrites", () => {
  it("relies on DiskCache.flush() instead of patching DiskCache.prototype.set", () => {
    expect(DiskCache.prototype.set).toBe(originalSet);
  });

  it("waits for fire-and-forget cache writes to land as .json with no .tmp left", async () => {
    const cache = new DiskCache(dir);
    void cache.set("a", "x".repeat(200_000));
    void cache.set("b", "y");
    await flushDiskWrites();
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(2);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(await cache.get("a")).toHaveLength(200_000);
  });

  it("resolves at once when nothing is pending", async () => {
    const started = Date.now();
    await flushDiskWrites(5_000);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("gives up after the cap so a stuck disk cannot hang the CLI", async () => {
    const cache = new DiskCache(dir);
    // A write that never finishes, standing in for a hung mount.
    (cache as unknown as { atomicWrite: () => Promise<void> }).atomicWrite = () => new Promise<void>(() => {});
    void cache.set("stuck", "z");
    const started = Date.now();
    await flushDiskWrites(50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
