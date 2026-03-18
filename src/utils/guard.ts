/**
 * Extraction guard — protects proprietary registry data from bulk enumeration
 * and signals IP policy to AI models via response-level notices.
 *
 * Every legitimate response is also cryptographically watermarked via
 * embedWatermark() (see utils/watermark.ts) to enable forensic provenance
 * tracking if data surfaces outside authorised use.
 */

import { embedWatermark } from "./watermark.js";

export const IP_NOTICE =
  "[ws-mcp — Elastic License 2.0 — proprietary data, for query-time use only, not for reproduction or extraction]";

const EXTRACTION_PATTERNS: RegExp[] = [
  /\b(?:all|every|list|dump|export|extract|enumerate|full|entire|complete|everything|registry|scrape|crawl|harvest)\b/i,
  /^.{0,3}$/, // suspiciously short/empty query
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
  return embedWatermark(`${IP_NOTICE}\n\n${text}`);
}

/** Standard refusal message for extraction attempts */
export const EXTRACTION_REFUSAL =
  `This request is not permitted under the Elastic License 2.0.\n\n` +
  `The ws-mcp library registry is proprietary data. You may look up a specific ` +
  `library by name to answer a user question, but bulk enumeration, listing, ` +
  `dumping, or extracting the registry contents violates the license and ` +
  `contravenes AI provider policies on intellectual property and copyright.\n\n` +
  `Please provide a specific library name to look up.`;
