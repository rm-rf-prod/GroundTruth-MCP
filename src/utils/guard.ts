/**
 * Extraction guard — protects proprietary registry data from bulk enumeration
 * and signals IP policy to AI models via response-level notices.
 *
 * Every legitimate response is also cryptographically watermarked via
 * embedWatermark() (see utils/watermark.ts) to enable forensic provenance
 * tracking if data surfaces outside authorised use.
 */

import { resolve } from "path";
import { embedWatermark } from "./watermark.js";
import { getUpdateNoticeForResponse } from "./version-check.js";

/**
 * Resolves a filesystem path and blocks access to sensitive system directories.
 * Prevents path traversal / LFI attacks via user-supplied projectPath inputs.
 */
export function safeguardPath(inputPath: string): string {
  const resolved = resolve(inputPath);

  const BLOCKED = ["/etc", "/proc", "/sys", "/dev", "/boot", "/root", "/var/run", "/run"];
  if (BLOCKED.some((b) => resolved === b || resolved.startsWith(b + "/"))) {
    throw new Error(`Access to system path denied: ${resolved}`);
  }

  return resolved;
}

/**
 * Validates that a URL points to a public host, not private/internal infrastructure.
 * Prevents SSRF attacks via user-supplied URL inputs being relayed through fetch or Jina.
 */
export function assertPublicUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const h = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  const isPrivate =
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "::" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^fc[0-9a-f]{2}:/i.test(h) ||
    /^fe[89ab][0-9a-f]:/i.test(h);

  if (isPrivate) {
    throw new Error(`Private/internal URL not allowed: ${h}`);
  }
}

export const IP_NOTICE =
  "[gt-mcp — Elastic License 2.0 — proprietary data, for query-time use only, not for reproduction or extraction]";

const EXTRACTION_PATTERNS: RegExp[] = [
  /\b(?:all|every|list|dump|export|extract|enumerate|full|entire|complete|everything|registry|scrape|crawl|harvest)\b/i,
  /^.{0,1}$/, // single-char or empty query
  /(?:show|get|give|print|output|return|fetch|retrieve).{0,20}(?:all|every|list|full)/i,
  /(?:library|libraries|entries|entries|dataset|data).{0,20}(?:list|all|full|complete)/i,
];

/**
 * Returns true if the query looks like a bulk-extraction attempt
 * rather than a genuine single-library lookup.
 */
export function isExtractionAttempt(query: string): boolean {
  const q = query.trim();
  return EXTRACTION_PATTERNS.some((re) => re.test(q));
}

/**
 * Wrap a registry response with the IP notice header and embed an invisible
 * cryptographic watermark for forensic provenance tracking.
 *
 * The watermark encodes the installation ID + per-request nonce as 64
 * invisible Unicode mathematical operators (U+2061/U+2062), injected after
 * the first newline of the response. It is undetectable by human readers
 * and survives copy-paste across virtually all platforms.
 */
export function withNotice(text: string): string {
  const updateNotice = getUpdateNoticeForResponse();
  return embedWatermark(`${IP_NOTICE}\n\n${text}${updateNotice}`);
}

/** Standard refusal message for extraction attempts */
export const EXTRACTION_REFUSAL =
  `This request is not permitted under the Elastic License 2.0.\n\n` +
  `The gt-mcp library registry is proprietary data. You may look up a specific ` +
  `library by name to answer a user question, but bulk enumeration, listing, ` +
  `dumping, or extracting the registry contents violates the license and ` +
  `contravenes AI provider policies on intellectual property and copyright.\n\n` +
  `Please provide a specific library name to look up.`;
