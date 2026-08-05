import { FETCH_TIMEOUT_MS } from "../../constants.js";
import { extractDomain, isCircuitOpen, recordSuccess, recordFailure } from "../circuit-breaker.js";
import { assertPublicUrl } from "../../utils/guard.js";
import { log } from "../../utils/logger.js";
import { fetchWithTimeout, readBodyCapped } from "./request.js";
import { RETRYABLE_STATUS, backoffDelayMs, isKnownMissing, rememberMissing } from "./negative-cache.js";

/** Single-URL fetch with retry, circuit-breaker accounting and negative caching. */
export async function tryFetch(url: string, retries = 1, extraHeaders?: Record<string, string>): Promise<string | null> {
  try { assertPublicUrl(url); } catch (err) {
    log({ level: "warn", msg: "tryFetch.ssrf_blocked", url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (isKnownMissing(url)) {
    log({ level: "debug", msg: "tryFetch.negative_cache_hit", url });
    return null;
  }
  const domain = extractDomain(url);
  if (isCircuitOpen(domain)) {
    log({ level: "debug", msg: "tryFetch.circuit_open", url, domain });
    return null;
  }
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, extraHeaders);
      lastStatus = res.status;
      if (RETRYABLE_STATUS.has(res.status)) {
        recordFailure(domain);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
          continue;
        }
        log({ level: "warn", msg: "tryFetch.upstream_unavailable", url, status: res.status, attempts: attempt + 1 });
        return null;
      }
      if (!res.ok) {
        // A 4xx is a definitive answer about ONE url, not a sick domain. Counting
        // it as a breaker failure let 3 expected auto-discovery 404s open the
        // circuit for the whole domain; recordSuccess also resolves a half-open
        // probe, which the breaker needs to leave that state.
        recordSuccess(domain);
        if (res.status === 404 || res.status === 410) rememberMissing(url);
        log({ level: "debug", msg: "tryFetch.http_error", url, status: res.status });
        return null;
      }
      const text = await readBodyCapped(res);
      if (text === null) {
        recordSuccess(domain);
        log({ level: "warn", msg: "tryFetch.body_too_large", url, status: res.status });
        return null;
      }
      if (text.length > 50) {
        recordSuccess(domain);
        return text;
      }
      // Served fine, just had nothing in it — the domain is healthy, so this
      // must resolve the circuit rather than count against it.
      recordSuccess(domain);
      log({ level: "debug", msg: "tryFetch.too_short", url, length: text.length });
      return null;
    } catch (err) {
      recordFailure(domain);
      lastError = err instanceof Error ? err.message : String(err);
      log({ level: "debug", msg: "tryFetch.exception", url, error: lastError, attempt });
      // A timeout (AbortError) means the deadline already passed — retrying just
      // burns another semaphore slot and timeout window for no gain.
      if (err instanceof Error && err.name === "AbortError") break;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt, 500)));
      }
    }
  }
  if (lastError !== undefined || lastStatus !== undefined) {
    log({
      level: "warn",
      msg: "tryFetch.exhausted",
      url,
      attempts: retries + 1,
      ...(lastError !== undefined ? { error: lastError } : {}),
      ...(lastStatus !== undefined ? { lastStatus } : {}),
    });
  }
  return null;
}
