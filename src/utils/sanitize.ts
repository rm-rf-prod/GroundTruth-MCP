import { INJECTION_PATTERNS } from "../constants.js";

// Navigation/footer patterns from Jina Reader output — strip these to save 15-25% tokens
const NAV_FOOTER_PATTERNS: RegExp[] = [
  // Skip-links and accessibility nav shortcuts
  /\[Skip to (main )?content\]\([^)]*\)/gi,
  /\[Skip navigation\]\([^)]*\)/gi,

  // Breadcrumb lines — "Home > Docs > Guide" or markdown link chains
  /^.*?\]\s*\/\s*\[.*?\]\s*\/\s*\[.*?$/gm,
  /^(Home|Docs?|Guide|Reference|API)\s*[>\/]\s*.+$/gm,

  // "Edit on GitHub" / "Edit this page" links
  /\[Edit (this page|on GitHub|on GitLab)[^\]]*\]\([^)]*\)/gi,
  /Edit (this page|on GitHub|on GitLab)/gi,

  // "View on GitHub" / "View source"
  /\[View (on GitHub|source)[^\]]*\]\([^)]*\)/gi,

  // "Previous / Next" page navigation
  /\[← ?(Previous|Back)[^\]]*\]\([^)]*\)/gi,
  /\[Next ?→[^\]]*\]\([^)]*\)/gi,
  /^\s*←\s*(Previous|Back)\s*\|\s*Next\s*→\s*$/gm,

  // Table of contents markers
  /^#+\s*(Table of Contents|Contents|On this page|In this (article|section))\s*$/gim,
  /^On this page\s*$/gim,

  // Pagination footer lines
  /^Page \d+ of \d+$/gm,

  // Cookie / privacy banners (commonly injected by Jina)
  /We use cookies.{0,200}(accept|agree|consent|privacy policy)/gi,
  /This site uses cookies.{0,200}(learn more|ok|accept)/gi,
  /By (using|continuing to use) this (site|website).{0,200}(privacy|cookies)/gi,

  // "Was this (page|article) helpful?" feedback widgets
  /Was this (page|article|section|doc) helpful\??[^\n]*/gi,
  /\[Yes\]\([^)]*\)\s*\[No\]\([^)]*\)/gi,
  /Thumbs (up|down)\s*\d*/gi,

  // Social share buttons
  /\[(Share|Tweet|LinkedIn|Facebook)[^\]]*\]\([^)]*\)/gi,

  // Search boxes
  /\[?\s*Search (docs|documentation|\.\.\.)\s*\]?/gi,

  // "Last updated" metadata lines
  /^Last updated:?\s+.+$/gim,
  /^Updated:?\s+[\w\s,]+\d{4}\.?$/gim,

  // Version switcher lines
  /^Version:?\s+v?\d+\.\d+[\.\d]*/gim,

  // Copyright footer lines
  /^Copyright\s+©?\s+\d{4}.+$/gim,
  /^©\s+\d{4}.+All rights reserved\.?$/gim,
  /^Released under the .+ [Ll]icense\.?$/gim,

  // "Made with" / "Powered by" lines
  /^Made with\s+.+$/gim,
  /^Powered by\s+.+$/gim,

  // CTA buttons in nav/header
  /\[(Get started|Sign up|Log in|Download|Try for free|Contact us)[^\]]*\]\([^)]*\)/gi,

  // Long nav link dumps — 5+ consecutive short markdown links on their own lines
  /(\[[\w\s/-]{1,40}\]\([^)]{0,100}\)\s*\n){5,}/g,

  // Sidebar-like sections: heading followed by only links
  /^#{2,4}\s*(Related|See [Aa]lso|Resources|Quick [Ll]inks|Useful [Ll]inks|More|Other|Popular)\s*\n(\[.+\]\(.+\)\s*\n?){2,}/gm,

  // Author bio sections
  /^#{2,4}\s*(About the [Aa]uthor|Written by|Author)\s*\n.{0,500}$/gm,

  // Newsletter signup / CTA blocks
  /^#{2,4}\s*(Subscribe|Newsletter|Stay [Uu]pdated|Join|Sign [Uu]p)\s*\n.{0,300}$/gm,

  // Changelog-style dates without content
  /^#{2,4}\s*v?\d+\.\d+[\.\d]*\s*[-\u2014]\s*\d{4}-\d{2}-\d{2}\s*$/gm,
];

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
  let normalized = text.replace(/[​-‏‪-‮⁠-⁩﻿­]/g, "");
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

  // First strip zero-width / RTL-override chars from the actual content too —
  // these have no legitimate use in technical docs and only enable bypass.
  sanitized = sanitized.replace(/[​-‏‪-‮⁠-⁩﻿]/g, "");

  // Strip nav/footer boilerplate first (before injection scan to reduce noise)
  for (const pattern of NAV_FOOTER_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  // Remove prompt injection attempts. Scan a normalized projection so
  // Unicode homoglyph variants ("ɪɢɴᴏʀᴇ previous") collapse to their ASCII
  // form before regex evaluation. When the normalized form matches, redact
  // the *original* matched substring length so visible content stays aligned.
  const normalized = normalizeForInjectionScan(sanitized);
  for (const pattern of INJECTION_PATTERNS) {
    // Reset regex state for global flags
    if (pattern.global) pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    const reGlobal = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + "g");
    const offsets: Array<{ start: number; end: number }> = [];
    while ((m = reGlobal.exec(normalized)) !== null) {
      offsets.push({ start: m.index, end: m.index + m[0].length });
      if (!pattern.global) break;
    }
    // Redact in reverse so earlier offsets stay valid
    for (let i = offsets.length - 1; i >= 0; i--) {
      const { start, end } = offsets[i]!;
      if (start < sanitized.length) {
        const safeEnd = Math.min(end, sanitized.length);
        sanitized = sanitized.slice(0, start) + "[content removed]" + sanitized.slice(safeEnd);
      }
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

  // Collapse excessive whitespace
  sanitized = sanitized.replace(/\n{4,}/g, "\n\n\n");

  return sanitized;
}
