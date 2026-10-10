import type { CacheEntry } from "../types.js";
import { CACHE_TTL_MS, SWR_STALE_TTL_MS } from "../constants.js";

/** Opt-in for readers that revalidate stale hits themselves: a longer stale window, and each hit's expiry. */
export interface RevalidatingRead {
  maxStaleMs: number;
  onHit: (expiresAt: number) => void;
}

export class LRUCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  /** Budget over the summed length of string values; entry count alone let 200 docs of 5 MB pile up. */
  private readonly maxChars: number;
  private chars = 0;

  constructor(maxSize = 200, maxChars = Infinity) {
    this.maxSize = maxSize;
    this.maxChars = maxChars;
  }

  get(key: string, read?: RevalidatingRead): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // Serve-stale within the SWR window to smooth over brief upstream hiccups;
    // drop entirely once the stale window has also elapsed.
    if (Date.now() > entry.expiresAt + (read?.maxStaleMs ?? SWR_STALE_TTL_MS)) {
      this.evict(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    read?.onHit(entry.expiresAt);
    return entry.data;
  }

  set(key: string, data: T, ttlMs = CACHE_TTL_MS): void {
    // Drop the old value first: it frees its budget and moves the key to the
    // most-recent end instead of evicting an unrelated entry at capacity.
    this.evict(key);
    const size = typeof data === "string" ? data.length : 0;
    if (size > this.maxChars) return;
    for (const oldest of this.store.keys()) {
      if (this.store.size < this.maxSize && this.chars + size <= this.maxChars) break;
      this.evict(oldest);
    }
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
    this.chars += size;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.store.clear();
    this.chars = 0;
  }

  size(): number {
    return this.store.size;
  }

  private evict(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.store.delete(key);
    if (typeof entry.data === "string") this.chars -= entry.data.length;
  }
}
