import type { CacheEntry } from "../types.js";
import { CACHE_TTL_MS, SWR_STALE_TTL_MS } from "../constants.js";

export class LRUCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const now = Date.now();
    if (now > entry.expiresAt) {
      // Serve-stale within the SWR window to smooth over brief upstream hiccups;
      // drop entirely once the stale window has also elapsed.
      if (now <= entry.expiresAt + SWR_STALE_TTL_MS) {
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.data;
      }
      this.store.delete(key);
      return undefined;
    }
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
