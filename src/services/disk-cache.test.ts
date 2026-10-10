import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, access, readdir } from "fs/promises";
import { createHash } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { DiskCache } from "./disk-cache.js";
import { SWR_STALE_TTL_MS } from "../constants.js";

let dir: string;
const fileFor = (key: string) => join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
const exists = (path: string) => access(path).then(() => true, () => false);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gt-disk-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DiskCache lazy cleanup (MEM-08)", () => {
  it("get() deletes a file that is not valid JSON", async () => {
    await writeFile(fileFor("torn"), '{"data":"x","expiresAt":', "utf-8");
    const cache = new DiskCache(dir);
    expect(await cache.get("torn")).toBeUndefined();
    expect(await exists(fileFor("torn"))).toBe(false);
  });

  it("get() deletes an entry past the stale window", async () => {
    const expiresAt = Date.now() - SWR_STALE_TTL_MS - 1000;
    await writeFile(fileFor("dead"), JSON.stringify({ data: "dead", expiresAt }), "utf-8");
    const cache = new DiskCache(dir);
    expect(await cache.get("dead")).toBeUndefined();
    expect(await exists(fileFor("dead"))).toBe(false);
  });

  it("prune() under the cap touches no file, not even a corrupt one", async () => {
    await writeFile(fileFor("torn"), "not json", "utf-8");
    await writeFile(fileFor("dead"), JSON.stringify({ data: "d", expiresAt: 1 }), "utf-8");
    const cache = new DiskCache(dir);
    expect(await cache.prune(10)).toBe(0);
    expect((await readdir(dir)).length).toBe(2);
  });

  it("prune() over the cap evicts the oldest files by mtime", async () => {
    const cache = new DiskCache(dir);
    for (let i = 0; i < 4; i++) {
      await writeFile(fileFor(`k${i}`), JSON.stringify({ data: `v${i}`, expiresAt: Date.now() + 60_000 }), "utf-8");
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(await cache.prune(2)).toBe(2);
    expect(await exists(fileFor("k0"))).toBe(false);
    expect(await exists(fileFor("k3"))).toBe(true);
  });
});

describe("DiskCache revalidating read (NET-05)", () => {
  it("serves an entry past the SWR window up to maxStaleMs and reports its expiry", async () => {
    const expiresAt = Date.now() - SWR_STALE_TTL_MS - 1000;
    await writeFile(fileFor("old"), JSON.stringify({ data: "old", expiresAt }), "utf-8");
    const cache = new DiskCache(dir);
    const onHit = vi.fn();
    expect(await cache.get("old", { maxStaleMs: 7 * 24 * 3_600_000, onHit })).toBe("old");
    expect(onHit).toHaveBeenCalledWith(expiresAt);
    expect(await exists(fileFor("old"))).toBe(true);
  });
});
