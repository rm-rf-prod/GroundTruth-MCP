import { STALE_REVALIDATE_MAX_MS } from "../../constants.js";
import { docCache, diskDocCache } from "../cache.js";
import { log } from "../../utils/logger.js";
import { detached, singleFlight } from "./single-flight.js";
import { inFlightRequests } from "./request.js";

/**
 * Stale-while-revalidate read of a cached doc: memory first, then disk. A disk
 * hit is promoted to memory with the entry's own expiry, not a fresh TTL. An
 * expired entry up to STALE_REVALIDATE_MAX_MS old is returned at once while
 * `refresh` replaces it in the background; `refresh` must be single-flight per
 * key (singleFlight) and write the cache itself.
 */
export async function readCached(key: string, refresh: () => Promise<unknown>): Promise<string | undefined> {
  const hit = { expiresAt: Infinity };
  const read = { maxStaleMs: STALE_REVALIDATE_MAX_MS, onHit: (expiresAt: number) => { hit.expiresAt = expiresAt; } };
  let data = docCache.get(key, read);
  if (data === undefined) {
    data = await diskDocCache.get(key, read);
    if (data === undefined) return undefined;
    docCache.set(key, data, hit.expiresAt - Date.now());
  }
  if (hit.expiresAt < Date.now()) {
    // Detached: the refresh outlives this call, so its cancellation must not cut it short.
    detached(refresh).catch((err: unknown) => {
      log({ level: "debug", msg: "readCached.refresh_failed", key, error: err instanceof Error ? err.message : String(err) });
    });
  }
  return data;
}

/**
 * readCached, else `fetchFresh` — single-flight per key, also as the stale
 * entry's background refresh. A value it returns is persisted by `store`.
 */
export async function readThrough(
  key: string,
  fetchFresh: () => Promise<string | null>,
  store: (value: string) => void,
): Promise<string | null> {
  const run = (): Promise<string | null> => singleFlight(inFlightRequests, key, async () => {
    const value = await fetchFresh();
    if (value) store(value);
    return value;
  });
  return (await readCached(key, run)) ?? run();
}
