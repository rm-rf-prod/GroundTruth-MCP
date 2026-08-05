/**
 * Retry policy and the 404 negative cache — both decide whether a URL is worth
 * another network round trip.
 */

/**
 * Statuses worth a retry: rate limiting, and the gateway errors a CDN emits
 * mid-redeploy. 4xx is a definitive answer — retrying it wastes a slot.
 */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Full-jitter exponential backoff (AWS "Exponential Backoff and Jitter").
 * Fixed linear delays made every one of the up-to-12 concurrent fetches retry
 * in lockstep after a shared 429, re-creating the burst that caused it.
 */
export function backoffDelayMs(attempt: number, base = 1000, cap = 8000): number {
  return Math.floor(Math.random() * Math.min(cap, base * 2 ** attempt));
}

/**
 * Negative cache for URLs that answered 404/410. Auto-discovery probes a fixed
 * set of candidate paths per domain; without this, every cache-miss call re-probes
 * the same known-dead URLs over the network.
 */
const NEGATIVE_TTL_MS = 120_000;
const NEGATIVE_CACHE_MAX = 2000;
const negativeCache = new Map<string, number>();

export function isKnownMissing(url: string): boolean {
  const until = negativeCache.get(url);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    negativeCache.delete(url);
    return false;
  }
  return true;
}

export function rememberMissing(url: string): void {
  if (negativeCache.size >= NEGATIVE_CACHE_MAX) {
    // Insertion-ordered: dropping the oldest key is a cheap FIFO eviction.
    const oldest = negativeCache.keys().next().value;
    if (oldest !== undefined) negativeCache.delete(oldest);
  }
  negativeCache.set(url, Date.now() + NEGATIVE_TTL_MS);
}

/** Test seam — clears the 404 negative cache between cases. */
export function clearNegativeCache(): void {
  negativeCache.clear();
}
