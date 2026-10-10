import { FETCH_TIMEOUT_MS } from "../../constants.js";
import { extractDomain, isCircuitOpen, recordSuccess, recordFailure } from "../circuit-breaker.js";
import { assertPublicUrl, currentCallSignal } from "../../utils/guard.js";
import { log } from "../../utils/logger.js";
import { HTML_ACCEPT, MARKDOWN_ACCEPT, fetchWithTimeout, pageAccept } from "./request.js";
import { discardBody, readBodyCapped, responseHeader } from "./body.js";
import {
  RETRYABLE_STATUS, backoffDelayMs, isKnownMissing, isOversize, rememberBrokenNegotiation, rememberMissing, rememberOversize,
} from "./negative-cache.js";

export interface FetchedText {
  text: string;
  /** Declared Content-Type ("" when absent): lets callers keep server markdown out of the HTML converter. */
  contentType: string;
}

/** Single-URL fetch with retry, circuit-breaker accounting and negative caching. */
export async function tryFetch(url: string, retries = 1, extraHeaders?: Record<string, string>): Promise<string | null> {
  return (await tryFetchText(url, retries, extraHeaders))?.text ?? null;
}

/** A docs page, negotiating markdown with hosts that serve it (see MARKDOWN_ACCEPT). */
export async function tryFetchPage(url: string, retries = 1): Promise<FetchedText | null> {
  return tryFetchText(url, retries, { Accept: pageAccept(url) });
}

/** tryFetch that also reports the response's content type. */
export async function tryFetchText(url: string, retries = 1, extraHeaders?: Record<string, string>): Promise<FetchedText | null> {
  try { assertPublicUrl(url); } catch (err) {
    log({ level: "warn", msg: "tryFetch.ssrf_blocked", url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (isKnownMissing(url) || isOversize(url)) {
    log({ level: "debug", msg: "tryFetch.negative_cache_hit", url });
    return null;
  }
  const domain = extractDomain(url);
  if (isCircuitOpen(domain)) {
    log({ level: "debug", msg: "tryFetch.circuit_open", url, domain });
    return null;
  }
  const negotiating = extraHeaders?.Accept === MARKDOWN_ACCEPT;
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, extraHeaders);
      lastStatus = res.status;
      if (!res.ok) discardBody(res);
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
        if (negotiating && (res.status === 404 || res.status === 406)) {
          // Some hosts 404 pages under markdown negotiation that they serve as
          // HTML (react.dev root, nuxt.com, redis.io/docs): ask once more without it.
          const page = await tryFetchText(url, 0, { ...extraHeaders, Accept: HTML_ACCEPT });
          if (page !== null) rememberBrokenNegotiation(url);
          return page;
        }
        if (res.status === 404 || res.status === 410) rememberMissing(url);
        log({ level: "debug", msg: "tryFetch.http_error", url, status: res.status });
        return null;
      }
      const text = await readBodyCapped(res);
      if (text === null) {
        recordSuccess(domain);
        rememberOversize(url);
        log({ level: "warn", msg: "tryFetch.body_too_large", url, status: res.status });
        return null;
      }
      if (text.length > 50) {
        recordSuccess(domain);
        return { text, contentType: responseHeader(res, "content-type") ?? "" };
      }
      // Served fine, just had nothing in it — the domain is healthy, so this
      // must resolve the circuit rather than count against it.
      recordSuccess(domain);
      log({ level: "debug", msg: "tryFetch.too_short", url, length: text.length });
      return null;
    } catch (err) {
      // The tool call was cancelled: that says nothing about the domain's health.
      if (currentCallSignal()?.aborted) return null;
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
