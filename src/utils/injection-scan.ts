import { INJECTION_PATTERNS } from "../constants.js";

// Small-caps + lookalike map. Keep this terse — only the chars that show
// up in common injection variants. Duplicates are removed since IPA-extensions
// and Latin small-cap blocks overlap on a few code points.
const HOMOGLYPHS: Record<string, string> = {
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
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");
// Zero-width / invisible chars. Unlike the content strip in sanitizeContent this
// includes U+FE0F, which stays in the visible text (emoji) but must not split a keyword.
const SCAN_INVISIBLE = /^(?:[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u180B-\u180E\uFE00-\uFE0F]|[\u{E0000}-\u{E007F}])$/u;
const NON_ASCII_RUN = /[^\x00-\x7f]+/g;
const scanForms = new Map<string, string>();

/** Scan form of one code point: invisible dropped, NFKD minus combining marks, lowercased, homoglyphs folded. */
function scanForm(ch: string): string {
  let form = scanForms.get(ch);
  if (form === undefined) {
    form = SCAN_INVISIBLE.test(ch)
      ? ""
      : ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(HOMOGLYPH_RE, (c) => HOMOGLYPHS[c] ?? c);
    if (scanForms.size < 8192) scanForms.set(ch, form);
  }
  return form;
}

/**
 * Strip Unicode chars commonly used to bypass prompt-injection regexes:
 * zero-width chars, RTL overrides, byte-order marks, soft hyphens.
 * Then NFKD-normalize, lowercase, and map known homoglyph categories
 * (small caps, fullwidth, mathematical alphanumerics) to ASCII so
 * homoglyph variants of "ignore", "system", etc. still match.
 *
 * The output of this function is ONLY used for injection-pattern scanning,
 * not as the returned content — preserves the user-visible formatting.
 *
 * Normalization changes length ("…" -> "...", "ﬁ" -> "fi", Hangul -> Jamo), so
 * when `origin` is given it receives the source offset of every output unit plus
 * a final `text.length` sentinel, to map match offsets back onto `text`.
 */
function normalizeForInjectionScan(text: string, origin?: number[]): string {
  const parts: string[] = [];
  let last = 0;
  // ASCII runs only need lowercasing; per-code-point work is limited to the rest.
  for (const run of text.matchAll(NON_ASCII_RUN)) {
    parts.push(text.slice(last, run.index).toLowerCase());
    if (origin) for (let o = last; o < run.index; o++) origin.push(o);
    let o = run.index;
    for (const ch of run[0]) {
      const form = scanForm(ch);
      parts.push(form);
      if (origin) for (let u = 0; u < form.length; u++) origin.push(o);
      o += ch.length;
    }
    last = o;
  }
  parts.push(text.slice(last).toLowerCase());
  if (origin) for (let o = last; o <= text.length; o++) origin.push(o);
  return parts.join("");
}

/**
 * Remove prompt injection attempts. Scan a normalized projection so
 * Unicode homoglyph variants ("ɪɢɴᴏʀᴇ previous") collapse to their ASCII
 * form before regex evaluation, then redact the matching span of the original.
 */
export function redactInjections(text: string): string {
  const normalized = normalizeForInjectionScan(text);
  // Collect ALL match ranges across every pattern against the single frozen
  // `normalized` snapshot BEFORE touching the text. Redacting inside the
  // pattern loop desynchronized later patterns' offsets from the mutated
  // string and spliced "[content removed]" into legitimate prose.
  const hits: Array<{ start: number; end: number }> = [];
  for (const pattern of INJECTION_PATTERNS) {
    // Reset regex state for global flags
    if (pattern.global) pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    const reGlobal = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + "g");
    while ((m = reGlobal.exec(normalized)) !== null) {
      if (m[0].length > 0) hits.push({ start: m.index, end: m.index + m[0].length });
      else reGlobal.lastIndex++;
      if (!pattern.global) break;
    }
  }
  const origin: number[] = [];
  if (hits.length > 0) normalizeForInjectionScan(text, origin);
  // Map back to source offsets. A match ending inside one character's expansion
  // ("instructionﬆ") extends to cover that whole character.
  const ranges = hits.map(({ start, end }) => {
    let k = end;
    while (origin[k] === origin[end - 1]) k++;
    return { start: origin[start]!, end: origin[k]! };
  });
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
  let out = text;
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start, end } = merged[i]!;
    out = out.slice(0, start) + "[content removed]" + out.slice(end);
  }

  // Belt-and-braces: also run patterns on the original sanitized text in case
  // normalization missed something.
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, "[content removed]");
  }
  return out;
}
