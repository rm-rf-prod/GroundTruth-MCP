import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { DiskCache } from "./disk-cache.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gt-disk-flush-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DiskCache.flush()", () => {
  it("waits for a fire-and-forget set() still creating the cache dir", async () => {
    const nested = join(dir, "a", "b");
    const cache = new DiskCache(nested);
    void cache.set("k", "v".repeat(100_000));
    await cache.flush();
    const files = await readdir(nested);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("also waits for a write started while flushing", async () => {
    const cache = new DiskCache(dir);
    void cache.set("first", "1").then(() => { void cache.set("second", "2"); });
    await cache.flush();
    expect(await cache.get("second")).toBe("2");
  });

  it("resolves at once with nothing pending", async () => {
    const started = Date.now();
    await new DiskCache(dir).flush();
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe("DiskCache.prune() orphaned tmp files", () => {
  it("removes .tmp files older than 10 minutes and keeps younger ones", async () => {
    const old = join(dir, "dead.json.abc.tmp");
    const young = join(dir, "live.json.def.tmp");
    await writeFile(old, "{", "utf-8");
    await writeFile(young, "{", "utf-8");
    const elevenMinutesAgo = (Date.now() - 11 * 60_000) / 1000;
    await utimes(old, elevenMinutesAgo, elevenMinutesAgo);

    await new DiskCache(dir).prune(1000);

    expect((await readdir(dir)).sort()).toEqual(["live.json.def.tmp"]);
  });
});
