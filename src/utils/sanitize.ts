import { INJECTION_PATTERNS } from "../constants.js";
import { decodeHtmlEntities, decodeCloudflareEmails, stripCloudflareEmailMarkdown } from "./decode-entities.js";

// Navigation/footer patterns from Jina Reader output — strip these to save 15-25% tokens
import { NAV_FOOTER_PATTERNS } from "../sources/nav-patterns.js";

/**
 * Remove prompt injection attempts from fetched documentation content.
 * Protects against ContextCrush-style attacks where library docs contain
 * malicious LLM instructions embedded in content.
 *
 * Also strips navigation chrome, footers, cookie banners, and other
 * boilerplate from Jina Reader output to reduce token waste by 15-25%.
 */
const MAX_SANITIZE_LENGTH = 512_000; // 500KB cap before regex processing

/**
 * Strip Unicode chars commonly used to bypass prompt-injection regexes:
 * zero-width chars, RTL overrides, byte-order marks, soft hyphens.
 * Then NFKD-normalize, lowercase, and map known homoglyph categories
 * (small caps, fullwidth, mathematical alphanumerics) to ASCII so
 * homoglyph variants of "ignore", "system", etc. still match.
 *
 * The output of this function is ONLY used for injection-pattern scanning,
 * not as the returned content — preserves the user-visible formatting.
 */
function normalizeForInjectionScan(text: string): string {
  // 1. Strip zero-width / invisible chars
  let normalized = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u180B-\u180E\uFE00-\uFE0F]|[\u{E0000}-\u{E007F}]/gu, "");
  // 2. NFKD normalize (handles fullwidth, some superscript)
  normalized = normalized.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // 3. Explicit small-caps homoglyph map (IPA extensions + modifier letters
  //    that NFKD does NOT cover). Coverage: enough to neutralize the
  //    common "ɪɢɴᴏʀᴇ ᴘʀᴇᴠɪᴏᴜs" / "sʏsᴛᴇᴍ" injection variants.
  // Small-caps + lookalike map. Keep this terse — only the chars that show
  // up in common injection variants. Duplicates are removed since IPA-extensions
  // and Latin small-cap blocks overlap on a few code points.
  const homoglyphMap: Record<string, string> = {
    // Latin small-cap (U+1D00-U+1D7F) + IPA extensions overlap
    "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ꜰ": "f", "ɢ": "g",
    "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m", "ɴ": "n",
    "ᴏ": "o", "ᴘ": "p", "ǫ": "q", "ʀ": "r", "ᴛ": "t", "ᴜ": "u",
    "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z",
    // Cyrillic visually identical to Latin (ASCII)
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
    "ѕ": "s", "і": "i", "ј": "j",
    // Greek lookalikes
    "α": "a", "ε": "e", "ο": "o", "ρ": "p", "σ": "s", "ι": "i", "ν": "v",
  };
  normalized = normalized
    .toLowerCase()
    .split("")
    .map((ch) => homoglyphMap[ch] ?? ch)
    .join("");
  return normalized;
}

export function sanitizeContent(content: string): string {
  let sanitized = content.length > MAX_SANITIZE_LENGTH
    ? content.slice(0, MAX_SANITIZE_LENGTH)
    : content;

  // Normalise line endings FIRST. Windows-authored doc sources (OWASP cheatsheets,
  // webaim.org, some GitHub-raw files) arrive as CRLF; the carriage returns split
  // the \n runs so neither the /\n{4,}/ collapse nor the line-anchored
  // NAV_FOOTER_PATTERNS below would fire — leaving visible blank-line spam.
  sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // First strip zero-width / RTL-override chars from the actual content too —
  // these have no legitimate use in technical docs and only enable bypass.
  sanitized = sanitized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u180B-\u180E\uFE00-\uFE0E]|[\u{E0000}-\u{E007F}]/gu, "");

  // Cloudflare email-protection: recover the real address when a #hex payload
  // survives (data-cfemail / href fragment), otherwise the placeholder links are
  // cleared by the cdn-cgi NAV_FOOTER_PATTERN below.
  sanitized = decodeCloudflareEmails(sanitized);
  sanitized = stripCloudflareEmailMarkdown(sanitized);

  // Strip nav/footer boilerplate first (before injection scan to reduce noise)
  for (const pattern of NAV_FOOTER_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  // Remove prompt injection attempts. Scan a normalized projection so
  // Unicode homoglyph variants ("ɪɢɴᴏʀᴇ previous") collapse to their ASCII
  // form before regex evaluation. When the normalized form matches, redact
  // the *original* matched substring length so visible content stays aligned.
  const normalized = normalizeForInjectionScan(sanitized);
  // Collect ALL match ranges across every pattern against the single frozen
  // `normalized` snapshot BEFORE touching `sanitized`. Redacting inside the
  // pattern loop desynchronized later patterns' offsets from the mutated
  // string and spliced "[content removed]" into legitimate prose.
  const ranges: Array<{ start: number; end: number }> = [];
  for (const pattern of INJECTION_PATTERNS) {
    // Reset regex state for global flags
    if (pattern.global) pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    const reGlobal = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + "g");
    while ((m = reGlobal.exec(normalized)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) reGlobal.lastIndex++;
      if (!pattern.global) break;
    }
  }
  // Merge overlapping ranges so two patterns hitting the same text produce
  // one marker instead of nested fragments.
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  // Single reverse pass — earlier offsets stay valid because the string is
  // only mutated after every offset has been resolved.
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start, end } = merged[i]!;
    if (start < sanitized.length) {
      const safeEnd = Math.min(end, sanitized.length);
      sanitized = sanitized.slice(0, start) + "[content removed]" + sanitized.slice(safeEnd);
    }
  }

  // Belt-and-braces: also run patterns on the original sanitized text in case
  // normalization missed something.
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[content removed]");
  }

  // Remove HTML script/style tags that could confuse the LLM
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, "");
  sanitized = sanitized.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Strip raw HTML structural preamble that leaks through when html-to-md
  // extraction fails to find a <main>/<article> region. These add zero
  // signal for an LLM consumer.
  sanitized = sanitized.replace(/<!DOCTYPE\s+[^>]*>/gi, "");
  sanitized = sanitized.replace(/<\/?html\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
  sanitized = sanitized.replace(/<\/?body\b[^>]*>/gi, "");
  // <meta>, <link>, <base> are self-closing structural tags
  sanitized = sanitized.replace(/<(?:meta|link|base)\b[^>]*\/?>/gi, "");

  // Decode HTML entities LAST — after the surgical tag strips above. This order is
  // mandatory: a doc that wrote `&lt;div&gt;` to SHOW a tag keeps `<div>` as faithful
  // text (sanitize only strips script/style/structural tags, never generic ones),
  // while any real `<script>`/`<head>` revealed by decoding was already removed.
  // Jina Reader, llms.txt and GitHub-raw markdown bypass html-to-md, so this is the
  // only place their `&para;`/`&rarr;`/`&copy;` entities get decoded.
  sanitized = decodeHtmlEntities(sanitized);
  // Numeric NBSP (&#160; / &#xA0;) decodes to U+00A0 — fold to a normal space so the
  // whitespace collapse below behaves and downstream tokenisation isn't polluted.
  sanitized = sanitized.replace(/\u00A0/g, " ");

  // Collapse excessive whitespace
  sanitized = sanitized.replace(/\n{4,}/g, "\n\n\n");

  return sanitized;
}
