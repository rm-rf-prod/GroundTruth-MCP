import { DISK_CACHE_DIR, SWR_STALE_TTL_MS, CACHE_TTL_MS } from "../constants.js";
import { createHash, randomBytes } from "crypto";
import { readFile, writeFile, mkdir, unlink, readdir, stat, rename } from "fs/promises";
import { join } from "path";
import { log } from "../utils/logger.js";
import type { RevalidatingRead } from "./lru-cache.js";

interface DiskCacheFile {
  data: string;
  expiresAt: number;
  contentHash?: string;
}

// Every set() in flight, across instances, so a short-lived process (the CLI)
// can wait for its fire-and-forget writes before it exits.
const pendingWrites = new Set<Promise<void>>();
// Older than any live write: a .tmp this old was orphaned by a killed process.
const ORPHAN_TMP_AGE_MS = 10 * 60 * 1000;

/**
 * Persistent disk cache — survives across npx invocations.
 * Keys are SHA-256 hashed; entries are JSON files with TTL metadata.
 * Falls back silently to no-op on any I/O error.
 */
export class DiskCache {
  private dir: string;
  private initialized = false;
  /** Per-key write lock — serializes concurrent writes to the same key */
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(dir = DISK_CACHE_DIR) {
    this.dir = dir;
  }

  private async ensureDir(): Promise<boolean> {
    if (this.initialized) return true;
    try {
      await mkdir(this.dir, { recursive: true });
      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  private keyToPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return join(this.dir, `${hash}.json`);
  }

  async get(key: string, read?: RevalidatingRead): Promise<string | undefined> {
    if (!(await this.ensureDir())) return undefined;
    const filePath = this.keyToPath(key);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return undefined;
    }
    try {
      const entry = JSON.parse(content) as DiskCacheFile;
      // Validate the deserialized shape — a truncated/corrupt file can parse to
      // a non-conforming object; don't serve it as if it were a valid entry.
      if (typeof entry !== "object" || entry === null || typeof entry.data !== "string" || typeof entry.expiresAt !== "number") {
        throw new Error("malformed cache entry");
      }
      if (Date.now() <= entry.expiresAt + (read?.maxStaleMs ?? SWR_STALE_TTL_MS)) {
        read?.onHit(entry.expiresAt);
        return entry.data;
      }
    } catch { /* corrupt: removed below, like an expired entry */ }
    // Lazy cleanup: prune() no longer reads every file, so expired and corrupt
    // entries are removed here, when they are first found.
    await unlink(filePath).catch(() => void 0);
    return undefined;
  }

  set(key: string, data: string, ttlMs = CACHE_TTL_MS): Promise<void> {
    const write = this.write(key, data, ttlMs);
    pendingWrites.add(write);
    const forget = (): void => { pendingWrites.delete(write); };
    write.then(forget, forget);
    return write;
  }

  /** Wait for every set() in flight on any instance, including writes started meanwhile. */
  async flush(): Promise<void> {
    while (pendingWrites.size > 0) await Promise.allSettled(pendingWrites);
  }

  private async write(key: string, data: string, ttlMs: number): Promise<void> {
    if (!(await this.ensureDir())) return;
    // Serialize concurrent writes to the same key — prevents interleaved
    // bytes from two simultaneous set() calls corrupting the file.
    const previous = this.writeLocks.get(key) ?? Promise.resolve();
    const next = previous.then(() => this.atomicWrite(key, data, ttlMs)).catch(() => {});
    this.writeLocks.set(key, next);
    try {
      await next;
    } finally {
      if (this.writeLocks.get(key) === next) this.writeLocks.delete(key);
    }
  }

  private async atomicWrite(key: string, data: string, ttlMs: number): Promise<void> {
    const filePath = this.keyToPath(key);
    // Random suffix prevents concurrent atomicWrite calls (in case the lock
    // fails for any reason) from racing on the same tmp filename.
    const tmpPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
    const entry: DiskCacheFile = { data, expiresAt: Date.now() + ttlMs };
    try {
      await writeFile(tmpPath, JSON.stringify(entry), "utf-8");
      await rename(tmpPath, filePath);
    } catch (err) {
      // Surface the write failure (disk full, EACCES, mount loss) — every disk
      // write funnels through here, so this is the single observability point
      // for the otherwise fire-and-forget cache writes.
      log({ level: "warn", msg: "DiskCache.atomicWrite.failed", error: err instanceof Error ? err.message : String(err) });
      // Best-effort cleanup of orphaned tmp file
      await unlink(tmpPath).catch(() => void 0);
    }
  }

  async has(key: string): Promise<boolean> {
    if (!(await this.ensureDir())) return false;
    const filePath = this.keyToPath(key);
    try {
      const content = await readFile(filePath, "utf-8");
      const entry = JSON.parse(content) as DiskCacheFile;
      if (typeof entry !== "object" || entry === null || typeof entry.expiresAt !== "number") {
        return false;
      }
      const now = Date.now();
      return now <= entry.expiresAt + SWR_STALE_TTL_MS;
    } catch {
      return false;
    }
  }

  async prune(maxEntries = 1000): Promise<number> {
    if (!(await this.ensureDir())) return 0;
    let removed = 0;
    try {
      const files = await readdir(this.dir);
      removed += await this.removeOrphanedTmp(files.filter((f) => f.endsWith(".tmp")));
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      // Under the cap there is nothing to do: reading and parsing every file at
      // boot and hourly cost ~40 MB RSS on a full cache. get() handles expiry.
      if (jsonFiles.length <= maxEntries) return removed;
      const entries: Array<{ path: string; mtime: number }> = [];
      for (const file of jsonFiles) {
        const filePath = join(this.dir, file);
        try {
          const s = await stat(filePath);
          entries.push({ path: filePath, mtime: s.mtimeMs });
        } catch { /* skip */ }
      }
      entries.sort((a, b) => a.mtime - b.mtime);
      for (const e of entries.slice(0, entries.length - maxEntries)) {
        await unlink(e.path).catch(() => void 0);
        removed++;
      }
    } catch { /* readdir failed — cache dir may not exist */ }
    return removed;
  }

  private async removeOrphanedTmp(tmpFiles: string[]): Promise<number> {
    let removed = 0;
    const cutoff = Date.now() - ORPHAN_TMP_AGE_MS;
    for (const file of tmpFiles) {
      const filePath = join(this.dir, file);
      try {
        if ((await stat(filePath)).mtimeMs >= cutoff) continue;
        await unlink(filePath);
        removed++;
      } catch { /* gone already */ }
    }
    return removed;
  }
}
