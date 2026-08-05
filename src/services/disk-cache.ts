import { DISK_CACHE_DIR, SWR_STALE_TTL_MS, CACHE_TTL_MS } from "../constants.js";
import { createHash, randomBytes } from "crypto";
import { readFile, writeFile, mkdir, unlink, readdir, stat, rename } from "fs/promises";
import { join } from "path";
import { log } from "../utils/logger.js";

interface DiskCacheFile {
  data: string;
  expiresAt: number;
  contentHash?: string;
}

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

  async get(key: string): Promise<string | undefined> {
    if (!(await this.ensureDir())) return undefined;
    const filePath = this.keyToPath(key);
    try {
      const content = await readFile(filePath, "utf-8");
      const entry = JSON.parse(content) as DiskCacheFile;
      // Validate the deserialized shape — a truncated/corrupt file can parse to
      // a non-conforming object; don't serve it as if it were a valid entry.
      if (typeof entry !== "object" || entry === null || typeof entry.data !== "string" || typeof entry.expiresAt !== "number") {
        unlink(filePath).catch(() => void 0);
        return undefined;
      }
      const now = Date.now();
      if (now > entry.expiresAt) {
        if (now <= entry.expiresAt + SWR_STALE_TTL_MS) {
          return entry.data;
        }
        unlink(filePath).catch(() => void 0);
        return undefined;
      }
      return entry.data;
    } catch {
      return undefined;
    }
  }

  async set(key: string, data: string, ttlMs = CACHE_TTL_MS): Promise<void> {
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
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      for (const file of jsonFiles) {
        const filePath = join(this.dir, file);
        try {
          const content = await readFile(filePath, "utf-8");
          const entry = JSON.parse(content) as DiskCacheFile;
          // Corrupt-but-parseable file (e.g. {}) has no numeric expiresAt — the
          // stale check below would compare against NaN and never prune it. Delete
          // it, mirroring the shape guards already in get()/has().
          if (typeof entry !== "object" || entry === null || typeof entry.expiresAt !== "number") {
            unlink(filePath).catch(() => void 0);
            removed++;
            continue;
          }
          // Match the serve-stale window used by get()/has(): only prune once the
          // SWR stale window has also elapsed, else we discard still-serveable data.
          if (Date.now() > entry.expiresAt + SWR_STALE_TTL_MS) {
            await unlink(filePath);
            removed++;
          }
        } catch {
          await unlink(filePath).catch(() => void 0);
          removed++;
        }
      }

      // Re-read the directory so the eviction guard reflects what is actually on
      // disk — `removed` can be inflated by fail-silent unlinks above, deflating
      // the count and skipping LRU eviction while the cache is still over cap.
      const currentFiles = await readdir(this.dir);
      const remainingJson = currentFiles.filter((f) => f.endsWith(".json"));
      if (remainingJson.length > maxEntries) {
        const entries: Array<{ path: string; mtime: number }> = [];
        for (const file of remainingJson) {
          const filePath = join(this.dir, file);
          try {
            const s = await stat(filePath);
            entries.push({ path: filePath, mtime: s.mtimeMs });
          } catch { /* skip */ }
        }
        entries.sort((a, b) => a.mtime - b.mtime);
        const toEvict = entries.slice(0, entries.length - maxEntries);
        for (const e of toEvict) {
          await unlink(e.path).catch(() => void 0);
          removed++;
        }
      }
    } catch { /* readdir failed — cache dir may not exist */ }
    return removed;
  }
}
