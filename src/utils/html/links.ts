import { decodeHtmlEntities } from "../decode-entities.js";

/** URL-scheme safety and tag stripping for converted markdown links. */
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

// Schemes safe to render as links in extracted markdown. Allowlist beats denylist:
// new schemes (e.g. intent:, file:, about:, vbscript:, livescript:, data:) auto-reject.
const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * Normalize an href captured from raw HTML before scheme inspection:
 *  - decode HTML entities (defeats `java&#x73;cript:` style bypass)
 *  - strip C0 control bytes (\x00-\x1F) + DEL (\x7F); browsers ignore TAB/LF/CR
 *    when resolving the scheme, so `java\tscript:` would otherwise pass
 *  - trim whitespace
 */
export function normalizeHref(rawHref: string): string {
  return decodeHtmlEntities(rawHref)
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
}

/**
 * Allowlist-based URL safety check. Caller must pass the normalized href.
 * Accepts: relative URLs, root-relative paths, fragments, http(s):, mailto:, tel:
 * Rejects: javascript:, data:, vbscript:, file:, about:, and any other scheme.
 */
export function isSafeHref(normalized: string): boolean {
  if (normalized === "") return false;
  if (normalized.startsWith("/") || normalized.startsWith("?") || normalized.startsWith("#")) {
    return true;
  }
  const colonIdx = normalized.indexOf(":");
  if (colonIdx === -1) return true; // relative URL, no scheme
  const slashIdx = normalized.indexOf("/");
  // Path segment with a literal colon before the first slash → treat as relative
  if (slashIdx !== -1 && slashIdx < colonIdx) return true;
  const scheme = normalized.slice(0, colonIdx).toLowerCase();
  return SAFE_URL_SCHEMES.has(scheme);
}

