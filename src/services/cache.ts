import type { CacheEntry, LibraryMatch } from "../types.js";
import { CACHE_TTL_MS, DISK_CACHE_DIR } from "../constants.js";
import { createHash } from "crypto";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";

class LRUCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  }

  set(key: string, data: T, ttlMs = CACHE_TTL_MS): void {
    if (this.store.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

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
      if (Date.now() > entry.expiresAt) {
        // Expired — delete async, don't await
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
    const filePath = this.keyToPath(key);
    const entry: DiskCacheFile = { data, expiresAt: Date.now() + ttlMs };
    try {
      await writeFile(filePath, JSON.stringify(entry), "utf-8");
    } catch {
      // Disk write failed — not fatal
    }
  }

  async has(key: string): Promise<boolean> {
    if (!(await this.ensureDir())) return false;
    const filePath = this.keyToPath(key);
    try {
      const content = await readFile(filePath, "utf-8");
      const entry = JSON.parse(content) as DiskCacheFile;
      return Date.now() <= entry.expiresAt;
    } catch {
      return false;
    }
  }
}

// Shared cache instances
export const docCache = new LRUCache<string>(200);
export const resolveCache = new LRUCache<LibraryMatch>(500);

// Persistent disk cache — survives across npx invocations
export const diskDocCache = new DiskCache();
