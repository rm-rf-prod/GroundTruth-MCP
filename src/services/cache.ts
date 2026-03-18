import type { CacheEntry } from "../types.js";
import { CACHE_TTL_MS } from "../constants.js";

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

// Shared cache instances
export const docCache = new LRUCache<string>(200);
export const resolveCache = new LRUCache<unknown>(500);
