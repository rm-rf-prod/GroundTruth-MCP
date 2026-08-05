import { createHash } from "crypto";
import { FETCH_TIMEOUT_MS, SERVER_VERSION } from "../../constants.js";
import { docCache, diskDocCache } from "../cache.js";
import { assertPublicUrl } from "../../utils/guard.js";
import { sanitizeContent } from "../../utils/sanitize.js";
import { log } from "../../utils/logger.js";
import { fetchSemaphore, hostSemaphore } from "./semaphore.js";
// Installs the SSRF-guarding DNS lookup on the global undici dispatcher.
import "./ssrf.js";

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
 * Cap remote response bodies so a malicious or misconfigured upstream cannot
 * exhaust memory by streaming gigabytes before truncation. Returns null when the
 * body exceeds `max` (by declared Content-Length or by streamed byte count).
 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function readBodyCapped(res: Response, max = MAX_RESPONSE_BYTES): Promise<string | null> {
  const headers = (res as { headers?: { get?: (k: string) => string | null } }).headers;
  const declared = Number(headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    return text.length > max ? null : text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function fetchWithTimeout(
  url: string,
  ms = FETCH_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  // Host bulkhead first, then the global cap: acquiring globally first would
  // let queued same-host waiters occupy global slots while blocked.
  const hostSem = hostSemaphore(url);
  await hostSem?.acquire();
  try {
    await fetchSemaphore.acquire();
  } catch (err) {
    hostSem?.release();
    throw err;
  }
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  // Once a successful response is returned, timer ownership moves to the body
  // stream — clearing it at header-receipt time would let a slow-drip body
  // hang callers indefinitely past the deadline.
  let timerHandedOff = false;
  try {
    let currentUrl = url;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/html,*/*", "Accept-Language": "en-US,en;q=0.9", ...extraHeaders },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res;
        currentUrl = new URL(location, currentUrl).href;
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
