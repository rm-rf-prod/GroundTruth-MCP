import { createHash } from "crypto";
import { FETCH_TIMEOUT_MS, SERVER_VERSION } from "../../constants.js";
import { docCache, diskDocCache } from "../cache.js";
import { assertPublicUrl, currentCallSignal } from "../../utils/guard.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { log } from "../../utils/logger.js";
import { fetchSemaphore, hostSemaphore } from "./semaphore.js";
import { breaksNegotiation } from "./negative-cache.js";
import { discardBody } from "./body.js";

// The SSRF-guarding undici dispatcher, loaded on first use rather than at startup.
let dispatcher: Promise<unknown> | undefined;

/**
 * Docs hosts that support it (Next.js, Cloudflare, Vercel, Stripe, TanStack,
 * react.dev) answer this with the page's own markdown: 20x smaller than the
 * HTML and independent of the HTML converter and Jina.
 */
export const MARKDOWN_ACCEPT = "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5";
export const HTML_ACCEPT = "text/plain,text/html,*/*";

/** Accept for a docs page: markdown, unless the host is known to 404 pages under negotiation. */
export function pageAccept(url: string): string {
  return breaksNegotiation(url) ? HTML_ACCEPT : MARKDOWN_ACCEPT;
}

/** In-flight deduplication: prevents N concurrent fetches of the same URL. */
export const inFlightRequests = new Map<string, Promise<string | null>>();

const MAX_REDIRECTS = 5;

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const USER_AGENT =
  `GroundTruth/${SERVER_VERSION} (docs-fetcher; +https://github.com/rm-rf-prod/GroundTruth-MCP)`;
/**
 * Write fetched documentation CONTENT to memory + disk cache, sanitizing once
 * before storage so poisoned upstream content is never persisted raw (SEC-009).
 * Metadata writes (npm/pypi JSON, sitemap URL lists) must NOT use this — running
 * them through the injection-stripper would corrupt the JSON.
 */
export function cacheDoc(cacheKey: string, content: string, ttl: number): void {
  const clean = sanitizeContent(content);
  docCache.set(cacheKey, clean, ttl);
  void diskDocCache.set(cacheKey, clean, ttl);
}

/** Build Authorization header for GitHub API if GT_GITHUB_TOKEN is set */
export function githubAuthHeaders(): Record<string, string> {
  const token = process.env.GT_GITHUB_TOKEN;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * The cookies a same-URL redirect sets (milvus.io answers 302 + Set-Cookie
 * milvus_challenge back to the same page), to echo once on the retry.
 */
function challengeCookie(res: Response, from: string, to: string): string | undefined {
  if (to !== from) return undefined;
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.length > 0 ? cookies.map((c) => c.split(";")[0]).join("; ") : undefined;
}

/**
 * fetch with a deadline that covers the body, SSRF-checked manual redirects,
 * the host and global semaphores, and the tool call's abort signal: a cancelled
 * call stops its requests and its semaphore waits. Shared work (single-flight,
 * background refresh) runs detached, so one caller cannot abort it for others.
 */
export async function fetchWithTimeout(
  url: string,
  ms = FETCH_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  await (dispatcher ??= import("./dispatcher.js"));
  const callSignal = currentCallSignal();
  // Host bulkhead first, then the global cap: acquiring globally first would
  // let queued same-host waiters occupy global slots while blocked.
  const hostSem = hostSemaphore(url);
  await hostSem?.acquire(callSignal);
  try {
    await fetchSemaphore.acquire(callSignal);
  } catch (err) {
    hostSem?.release();
    throw err;
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  const signal = callSignal ? AbortSignal.any([controller.signal, callSignal]) : controller.signal;
  // Once a successful response is returned, timer ownership moves to the body
  // stream — clearing it at header-receipt time would let a slow-drip body
  // hang callers indefinitely past the deadline.
  let timerHandedOff = false;
  try {
    let currentUrl = url;
    const origin = new URL(url).origin;
    let cookie: string | undefined;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const hopHeaders: Record<string, string> = { "User-Agent": USER_AGENT, Accept: HTML_ACCEPT, "Accept-Language": "en-US,en;q=0.9", ...extraHeaders };
      // Fetch-spec behaviour the manual redirect loop has to restore: credentials
      // (GT_GITHUB_TOKEN, the challenge cookie) never follow a redirect to another origin.
      if (new URL(currentUrl).origin !== origin) {
        for (const name of Object.keys(hopHeaders)) if (name.toLowerCase() === "authorization") delete hopHeaders[name];
      } else if (cookie) {
        hopHeaders.Cookie = cookie;
      }
      const res = await fetch(currentUrl, {
        signal,
        redirect: "manual",
        headers: hopHeaders,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res;
        discardBody(res);
        const next = new URL(location, currentUrl).href;
        // Only one echo, and only for the original origin: a loop that keeps
        // setting cookies still ends at MAX_REDIRECTS.
        if (!cookie && new URL(next).origin === origin) cookie = challengeCookie(res, currentUrl, next);
        currentUrl = next;
        try { assertPublicUrl(currentUrl); } catch (err) {
          log({ level: "warn", msg: "fetchWithTimeout.ssrf_redirect_blocked", url: currentUrl, error: err instanceof Error ? err.message : String(err) });
          return res;
        }
        continue;
      }
      const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
      if (!body || typeof body.getReader !== "function") return res;
      const reader = body.getReader();
      const wrapped = new ReadableStream<Uint8Array>({
        async pull(c) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(id);
              c.close();
              return;
            }
            if (value) c.enqueue(value);
          } catch (err) {
            clearTimeout(id);
            c.error(err);
          }
        },
        cancel(reason) {
          clearTimeout(id);
          return reader.cancel(reason);
        },
      });
      timerHandedOff = true;
      return new Response(wrapped, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    throw new Error(`Too many redirects for ${url}`);
  } finally {
    if (!timerHandedOff) clearTimeout(id);
    fetchSemaphore.release();
    hostSem?.release();
  }
}
