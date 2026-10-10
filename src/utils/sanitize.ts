import { decodeHtmlEntities, decodeCloudflareEmails, stripCloudflareEmailMarkdown } from "./decode-entities.js";
import { redactInjections } from "./injection-scan.js";

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
export const MAX_SANITIZE_LENGTH = 512_000; // 500KB cap before regex processing

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u180B-\u180E\uFE00-\uFE0E]|[\u{E0000}-\u{E007F}]/gu;

const MARKUP = [
  // Remove HTML script/style tags that could confuse the LLM
  /<script[\s\S]*?<\/script>/gi,
  /<style[\s\S]*?<\/style>/gi,
  // Strip raw HTML structural preamble that leaks through when html-to-md
  // extraction fails to find a <main>/<article> region. These add zero
  // signal for an LLM consumer.
  /<!DOCTYPE\s+[^>]*>/gi,
  /<\/?html\b[^>]*>/gi,
  /<head\b[^>]*>[\s\S]*?<\/head>/gi,
  /<\/?body\b[^>]*>/gi,
  // <meta>, <link>, <base> are self-closing structural tags
  /<(?:meta|link|base)\b[^>]*\/?>/gi,
];

// Repeats until stable: dropping `<script></script>` out of
// `<scr<script></script>ipt>` forms a new tag that one round would leave behind.
function stripMarkup(text: string): string {
  let out = text;
  for (let prev = ""; out !== prev; ) {
    prev = out;
    for (const re of MARKUP) out = out.replace(re, "");
  }
  return out;
}

const ANCHOR = /(?<!!)\[([^[\]\n]+)\]\(#[^()\s]*\)/g;
const HEADING_IDS = /(?:[ \t]*(?:\{(?:#[\w-]+|\/\*[^*\n]*\*\/)\}|\[#[a-z][\w-]*\]))+[ \t]*$/;

// MDX page chrome, in one pass so code is never touched: a fenced block (kept
// whole, even unclosed), a heading line (its ids {/*x*/}, {#x}, [#x] stripped
// below), a line that is only a page-chrome tag (<Intro>, </DeepDive>,
// <InlineToc />) and an in-page anchor link, which keeps its text. Tag lines allow
// 3 leading spaces; 4 is an indented code block. Chrome tags are named, because
// any PascalCase tag line would eat JSX from unfenced code fragments.
const MDX_RESIDUE = new RegExp([
  /^[ \t]*(```|~~~)[^]*?(?:^[ \t]*\1.*$|(?![^]))/.source,
  /^(#{1,6} [^\n]*)/.source,
  /^ {0,3}<\/?(?:Intro|InlineToc|YouWillLearn|DeepDive|Pitfall|Recipes|AgentInstructions)(?:[ \t][^<>\n]*)?\/?>[ \t]*(?:\n|$)/.source,
  ANCHOR.source,
].join("|"), "gm");

export function stripMdxResidue(text: string): string {
  return text.replace(MDX_RESIDUE, (m, fence?: string, heading?: string, anchor?: string) => {
    if (fence) return m;
    if (heading === undefined) return anchor ?? "";
    // shortcut: ids are stripped only from headings up to 300 chars, because
    // HEADING_IDS is quadratic in line length; that bounds a hostile 512 KB page at ~0.1 s.
    return (heading.length <= 300 ? heading.replace(HEADING_IDS, "") : heading).replace(ANCHOR, "$1");
  });
}

// Large outputs already handed out. Warm cache reads re-sanitize them; returning
// them as-is keeps warm answers identical to cold ones and skips a full pass.
// Small strings are cheap to redo and would only churn the slots.
const knownClean = new Set<string>();
let knownChars = 0;

function rememberClean(out: string): void {
  if (out.length < 4_096 || out.length > MAX_SANITIZE_LENGTH || knownClean.has(out)) return;
  for (const old of knownClean) {
    if (knownClean.size < 16 && knownChars + out.length <= 4_000_000) break;
    knownClean.delete(old);
    knownChars -= old.length;
  }
  knownClean.add(out);
  knownChars += out.length;
}

export function sanitizeContent(content: string): string {
  if (knownClean.has(content)) return content;
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
  sanitized = sanitized.replace(INVISIBLE, "");

  // Cloudflare email-protection: recover the real address when a #hex payload
  // survives (data-cfemail / href fragment), otherwise the placeholder links are
  // cleared by the cdn-cgi NAV_FOOTER_PATTERN below.
  sanitized = decodeCloudflareEmails(sanitized);
  sanitized = stripCloudflareEmailMarkdown(sanitized);

  // Strip nav/footer boilerplate first (before injection scan to reduce noise)
  for (const pattern of NAV_FOOTER_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  sanitized = stripMarkup(sanitized);

  // Decode HTML entities after the surgical tag strips above and before the
  // injection scan below. A doc that wrote `&lt;div&gt;` to SHOW a tag keeps
  // `<div>` as faithful text (sanitize only strips script/style/structural tags,
  // never generic ones). Decoding can reveal invisible chars (`&#8203;`,
  // `&#xE0069;`) and script/structural tags, so both strips run again on the
  // decoded text: one pass must reach a fixed point, or the known-clean memo
  // would hand out what a second pass strips. The invisible strip is unconditional
  // because Cloudflare email decoding above can emit any code point too.
  // Jina Reader, llms.txt and GitHub-raw markdown bypass html-to-md, so this is the
  // only place their `&para;`/`&rarr;`/`&copy;` entities get decoded.
  const decoded = decodeHtmlEntities(sanitized).replace(INVISIBLE, "");
  if (decoded !== sanitized) sanitized = stripMarkup(decoded);
  // Numeric NBSP (&#160; / &#xA0;) decodes to U+00A0 — fold to a normal space so the
  // whitespace collapse below behaves and downstream tokenisation isn't polluted.
  sanitized = sanitized.replace(/\u00A0/g, " ");

  // MDX chrome after decoding, so a decoded tag line is stripped in this same
  // pass (fixed point), and before the injection scan, so the text an anchor
  // link leaves behind is scanned too.
  sanitized = stripMdxResidue(sanitized);

  // Scan decoded text: `&lt;system&gt;` or `&#105;gnore previous instructions`
  // must not slip past the patterns and come out decoded.
  sanitized = redactInjections(sanitized);

  // Collapse excessive whitespace
  sanitized = sanitized.replace(/\n{4,}/g, "\n\n\n");

  rememberClean(sanitized);
  return sanitized;
}

/**
 * One-line form of publisher-controlled metadata (package descriptions, homepages):
 * sanitized, whitespace flattened so it cannot open new markdown blocks, and capped.
 */
export function sanitizeInline(text: string, max = 300): string {
  return sanitizeContent(text).replace(/\s+/g, " ").trim().slice(0, max);
}
