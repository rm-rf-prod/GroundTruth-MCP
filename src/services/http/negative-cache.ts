/**
 * Retry policy, the 404 negative cache and markdown-negotiation verdicts — all
 * decide whether a URL is worth another network round trip.
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

function isLive(cache: Map<string, number>, url: string): boolean {
  const until = cache.get(url);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    cache.delete(url);
    return false;
  }
  return true;
}

function remember(cache: Map<string, number>, url: string, ttlMs: number): void {
  if (cache.size >= NEGATIVE_CACHE_MAX) {
    // Insertion-ordered: dropping the oldest key is a cheap FIFO eviction.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, Date.now() + ttlMs);
}

export function isKnownMissing(url: string): boolean {
  return isLive(negativeCache, url);
}

export function rememberMissing(url: string): void {
  remember(negativeCache, url, NEGATIVE_TTL_MS);
}

/**
 * Bodies over the response cap (6-7 MB llms-full.txt files) were re-downloaded
 * and discarded on every call. Kept apart from the 404 cache: the page exists,
 * only the direct download is futile, so Jina's compact render may still serve it.
 */
const OVERSIZE_TTL_MS = 24 * 60 * 60 * 1000;
const oversizeCache = new Map<string, number>();

export function isOversize(url: string): boolean {
  return isLive(oversizeCache, url);
}

export function rememberOversize(url: string): void {
  remember(oversizeCache, url, OVERSIZE_TTL_MS);
}

/**
 * Hosts that 404 pages under `Accept: text/markdown` which they serve as HTML
 * (react.dev root, nuxt.com unversioned paths, redis.io/docs): stop negotiating.
 * Only this verdict is kept. Hosts are mixed (redis.io serves some paths as
 * markdown, 404s others), so one real 404 must not switch off the HTML retry;
 * repeats of a missing URL are already bounded by its own negative-cache entry.
 */
const brokenNegotiationHosts = new Set<string>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function breaksNegotiation(url: string): boolean {
  return brokenNegotiationHosts.has(hostOf(url));
}

export function rememberBrokenNegotiation(url: string): void {
  if (brokenNegotiationHosts.size >= NEGATIVE_CACHE_MAX) brokenNegotiationHosts.clear();
  brokenNegotiationHosts.add(hostOf(url));
}

/** Test seam — clears the 404 and oversize caches and negotiation verdicts between cases. */
export function clearNegativeCache(): void {
  negativeCache.clear();
  oversizeCache.clear();
  brokenNegotiationHosts.clear();
}
