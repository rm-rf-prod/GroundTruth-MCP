import { JINA_BASE_URL, CACHE_TTLS } from "../../constants.js";
import { extractDomain, isCircuitOpen, recordSuccess, recordFailure } from "../circuit-breaker.js";
import { docCache } from "../cache.js";
import { assertPublicUrl } from "../../utils/guard.js";
import { log } from "../../utils/logger.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { fetchWithTimeout, inFlightRequests } from "./request.js";
import { readBodyCapped } from "./body.js";
import { isGarbageContent } from "../content-guards.js";
import { isKnownMissing } from "./negative-cache.js";
import { singleFlight } from "./single-flight.js";

/** Anonymous Jina traffic is the most aggressively rate-limited pool; a key moves calls out of it. */
function jinaAuthHeaders(): Record<string, string> {
  const key = process.env.GT_JINA_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

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
  // Rendering a page that just answered 404 burns Jina quota and time for nothing.
  if (isKnownMissing(url)) return null;

  const jinaUrl = `${JINA_BASE_URL}/${url}`;
  const cacheKey = `jina:${url}`;

  // Memory only: every caller persists the result under its own key (md:,
  // docs:, devdocs:), so a disk copy here was a byte-identical duplicate.
  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  // Deduplicate concurrent requests for the same URL
  return singleFlight(inFlightRequests, cacheKey, async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(jinaUrl, 25_000, {
          "X-Return-Format": "markdown",
          "X-Exclude-Selector": "nav,footer,aside,.sidebar,.ads,#comments,.cookie-banner,.cookie-consent,#cookie-notice,.newsletter-signup",
          "X-Wait-For-Selector": "main,article,.docs-content,[role=main]",
          ...jinaAuthHeaders(),
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
        // Sanitized before storage so poisoned upstream content is never held raw (SEC-009).
        docCache.set(cacheKey, sanitizeContent(text), CACHE_TTLS.JINA_RESULT);
        return text;
      } catch {
        recordFailure(jinaDomain);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  });
}
