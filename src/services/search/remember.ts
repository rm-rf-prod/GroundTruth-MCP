import { docCache } from "../cache.js";

/**
 * Memoise a search engine's URL list in memory for `ttlMs`. Empty answers are
 * not remembered: they may be an outage, and a repeat should try again.
 */
export async function remembered<T>(key: string, ttlMs: number, search: () => Promise<T[]>): Promise<T[]> {
  const cached = docCache.get(key);
  if (typeof cached === "string") {
    try {
      return JSON.parse(cached) as T[];
    } catch {
      // unreadable entry: search again
    }
  }
  const found = await search();
  if (found.length > 0) docCache.set(key, JSON.stringify(found), ttlMs);
  return found;
}
