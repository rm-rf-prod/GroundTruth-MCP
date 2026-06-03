/**
 * Shared HTML-entity and Cloudflare-email decoding for the documentation
 * cleaning pipeline.
 *
 * Used by both html-to-md.ts (the direct-HTML extraction path) and sanitize.ts
 * (the universal post-fetch chokepoint). Jina Reader, llms.txt and GitHub-raw
 * content bypass html-to-md entirely and arrive as markdown that still carries
 * named/numeric HTML entities (e.g. `&para;`, `&rarr;`, `&copy;`) and Cloudflare
 * email-protection placeholders — sanitize.ts is the only place those get cleaned,
 * so the decoder must live in one shared module both can import.
 *
 * Ordering contract (important):
 *  - In html-to-md, decode runs AFTER the generic `<[^>]+>` tag strip, so an
 *    author who wrote `&lt;b&gt;` to SHOW a tag keeps `<b>` as visible text.
 *  - In sanitize, decode runs BEFORE the SURGICAL strips (script/style/structural
 *    only). Revealed real `<script>`/`<html>` get stripped; `<div>`/`<b>` survive.
 *    Decoding before the injection scan also closes the `&#73;gnore` bypass.
 */

// Named HTML entities common in scraped technical documentation. Maps to the real
// Unicode glyph (faithful content) — `&nbsp;` maps to a normal space on purpose so
// downstream whitespace collapse and trim work without a U+00A0 special case.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", zwnj: "", zwj: "", shy: "",
  copy: "©", reg: "®", trade: "™",
  mdash: "—", ndash: "–", minus: "−",
  hellip: "…", bull: "•", middot: "·", sdot: "⋅",
  rarr: "→", larr: "←", uarr: "↑", darr: "↓", harr: "↔",
  rArr: "⇒", lArr: "⇐", hArr: "⇔",
  laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„",
  dagger: "†", Dagger: "‡", sect: "§", para: "¶",
  deg: "°", times: "×", divide: "÷", plusmn: "±",
  ne: "≠", le: "≤", ge: "≥", asymp: "≈", equiv: "≡",
  infin: "∞", radic: "√", sum: "∑", prod: "∏", part: "∂",
  euro: "€", pound: "£", yen: "¥", cent: "¢", curren: "¤",
  frac12: "½", frac14: "¼", frac34: "¾",
  sup1: "¹", sup2: "²", sup3: "³",
  micro: "µ", permil: "‰", prime: "′", Prime: "″",
  loz: "◊", spades: "♠", clubs: "♣", hearts: "♥", diams: "♦",
  star: "☆", check: "✓", cross: "✗",
  szlig: "ß", AElig: "Æ", aelig: "æ", OElig: "Œ", oelig: "œ",
  Aring: "Å", aring: "å", Auml: "Ä", auml: "ä",
  Ouml: "Ö", ouml: "ö", Uuml: "Ü", uuml: "ü",
  ccedil: "ç", Ccedil: "Ç", ntilde: "ñ", Ntilde: "Ñ",
  eacute: "é", egrave: "è", agrave: "à", uacute: "ú",
  oacute: "ó", iacute: "í", aacute: "á",
};

/**
 * Decode named (`&copy;`), decimal (`&#169;`) and hex (`&#xA9;`) HTML entities in
 * a single pass. Unknown named entities are preserved verbatim so we never corrupt
 * content we don't understand. Idempotent for already-decoded text (no `&...;` left).
 */
export function decodeHtmlEntities(text: string): string {
  if (!text || text.indexOf("&") === -1) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body.charCodeAt(0) === 35) {
      // numeric: #NNN (decimal) or #xHH (hex)
      const isHex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
      const cp = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return match;
      // Drop C0/C1 control chars (except tab/newline) — they are noise, not content.
      if ((cp >= 0 && cp <= 8) || (cp >= 11 && cp <= 31) || (cp >= 127 && cp <= 159)) {
        return cp === 127 ? "" : " ";
      }
      // Fold every non-breaking / exotic space form to a normal space so downstream
      // whitespace collapse + trim work (U+00A0 NBSP, U+2007/U+202F, U+2000-200A).
      if (cp === 0xa0 || cp === 0x2007 || cp === 0x202f || (cp >= 0x2000 && cp <= 0x200a)) {
        return " ";
      }
      try {
        return String.fromCodePoint(cp);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    if (named === undefined) return match;
    // Normalise any non-breaking space the named map yields to a plain space.
    return named.length === 1 && named.charCodeAt(0) === 0xa0 ? " " : named;
  });
}

/**
 * Cloudflare email-protection XOR decode. The `data-cfemail` / href-fragment hex
 * string is the email bytes XORed with a per-render key stored in the first byte.
 * Returns "" on malformed input rather than throwing.
 */
export function decodeCfEmail(hex: string): string {
  if (!hex || hex.length < 4 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return "";
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  // escape()+decodeURIComponent() reconstructs multi-byte UTF-8 code points that
  // the byte-wise XOR produced. Fall back to the raw bytes if that fails.
  try {
    return decodeURIComponent(escape(out));
  } catch {
    return out;
  }
}

/**
 * Decode/strip Cloudflare email obfuscation in RAW HTML (the `<a class="__cf_email__"
 * data-cfemail="HEX">` and `<a href=".../cdn-cgi/l/email-protection#HEX">` forms,
 * plus the leftover loader `<script>`). Recovers the real address where possible.
 */
export function decodeCloudflareEmails(html: string): string {
  if (!html || html.indexOf("cf_email") === -1 && html.indexOf("/cdn-cgi/l/email-protection") === -1) {
    return html;
  }
  let out = html;
  // <a> / <span> carrying data-cfemail (attribute order varies)
  out = out.replace(/<(a|span)\b[^>]*\bdata-cfemail="([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/\1>/gi,
    (_m, _tag, hex: string) => decodeCfEmail(hex));
  // href-fragment form
  out = out.replace(/<a\b[^>]*\bhref="[^"]*\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/a>/gi,
    (_m, hex: string) => decodeCfEmail(hex));
  // leftover Cloudflare loader script
  out = out.replace(/<script\b[^>]*\/cdn-cgi\/scripts\/[^>]*>[\s\S]*?<\/script>/gi, "");
  return out;
}

/**
 * Decode/strip the MARKDOWN form of Cloudflare email protection that Jina Reader
 * emits, e.g. `[[email protected]](/cdn-cgi/l/email-protection)` or
 * `[[email protected]](https://site/cdn-cgi/l/email-protection#HEX)`. When a hex
 * payload is present the real address is recovered; otherwise the protected
 * placeholder (which carries no signal) is removed.
 */
export function stripCloudflareEmailMarkdown(md: string): string {
  if (!md || md.indexOf("/cdn-cgi/l/email-protection") === -1 && !/\[email\s*protected\]/i.test(md)) {
    return md;
  }
  let out = md;
  // Replace the parenthetical cdn-cgi URL — decode when a #HEX fragment is present.
  out = out.replace(/\((?:https?:\/\/[^)\s]*)?\/cdn-cgi\/l\/email-protection(?:#([0-9a-fA-F]+))?\)/gi,
    (_m, hex: string | undefined) => (hex ? ` ${decodeCfEmail(hex)} ` : ""));
  // Remove the now-dangling protected-email link text (handles single/double brackets).
  out = out.replace(/\[?\[\s*email\s+protected\s*\]\]?/gi, "");
  return out;
}
