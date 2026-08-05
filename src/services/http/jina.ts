import { JINA_BASE_URL, CACHE_TTLS } from "../../constants.js";
import { extractDomain, isCircuitOpen, recordSuccess, recordFailure } from "../circuit-breaker.js";
import { docCache, diskDocCache } from "../cache.js";
import { assertPublicUrl } from "../../utils/guard.js";
import { log } from "../../utils/logger.js";
import { fetchWithTimeout, readBodyCapped, cacheDoc, inFlightRequests } from "./request.js";
import { isGarbageContent } from "../content-guards.js";

/** Fetch via Jina Reader — converts any URL to clean markdown */
export async function fetchViaJina(url: string): Promise<string | null> {
  try {
    assertPublicUrl(url);
  } catch (err) {
    log({ level: "warn", msg: "fetchViaJina.ssrf_blocked", url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }

  const jinaDomain = extractDomain(JINA_BASE_URL);
  if (isCircuitOpen(jinaDomain)) return null;

  const jinaUrl = `${JINA_BASE_URL}/${url}`;
  const cacheKey = `jina:${url}`;

  // Check memory cache first
  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  // Check disk cache (survives across npx invocations)
  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached); // warm memory cache
    return diskCached;
  }

  // Deduplicate concurrent requests for the same URL
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(jinaUrl, 25_000, {
          "X-Return-Format": "markdown",
          "X-Exclude-Selector": "nav,footer,aside,.sidebar,.ads,#comments,.cookie-banner,.cookie-consent,#cookie-notice,.newsletter-signup",
          "X-Wait-For-Selector": "main,article,.docs-content,[role=main]",
        });
        if (res.status === 429 || res.status === 503) {
          recordFailure(jinaDomain);
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          return null;
        }
        if (!res.ok) {
          recordFailure(jinaDomain);
          return null;
        }
        const text = await readBodyCapped(res);
        if (text === null) {
          recordFailure(jinaDomain);
          log({ level: "warn", msg: "fetchViaJina.body_too_large", url });
          return null;
        }
        if (text.length < 100) return null;
        // Jina answers 200 even when the TARGET page 404'd or is a challenge/login
        // shell — rendered garbage must never be returned or cached as content.
        const garbage = isGarbageContent(text);
        if (garbage.garbage) {
          log({ level: "warn", msg: "fetchViaJina.garbage_rejected", url, reason: garbage.reason });
          recordSuccess(jinaDomain); // Jina itself worked — the target was bad
          return null;
        }
        recordSuccess(jinaDomain);
        cacheDoc(cacheKey, text, CACHE_TTLS.JINA_RESULT);
        return text;
      } catch {
        recordFailure(jinaDomain);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
