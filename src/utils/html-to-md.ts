/**
 * Lightweight HTML-to-Markdown extractor.
 * Converts raw HTML documentation pages into readable markdown
 * without external dependencies (no cheerio, no jsdom).
 *
 * This is the critical Jina Reader fallback — when Jina is rate-limited,
 * slow, or down, this extracts useful content from raw HTML.
 */

import { decodeHtmlEntities } from "./decode-entities.js";

import { stripNoisyElements, extractMainContent } from "./html/clean.js";
import { stripTags, normalizeHref, isSafeHref } from "./html/links.js";
import { convertTable } from "./html/table.js";

// Highlighters (shiki, prism) wrap each code line in its own element, separated
// by a newline, a trailing <br>, or nothing at all.
const LINE_TAG = /<(?:span|div)\s[^>]*?class=["']?(?:token-)?line(?=[\s"'>])[^>]*>/gi;
const BR = /<br\s*\/?>/gi;

/** Plain text of a code block: one line per line element, indentation kept, entities decoded once. */
function codeText(html: string): string {
  const [head = "", ...lines] = html.split(LINE_TAG);
  const text = lines.length === 0
    ? stripTags(html.replace(BR, "\n"))
    : stripTags(head) + lines.map((line) => stripTags(line.replace(BR, "")).replace(/\n$/, "")).join("\n");
  return decodeHtmlEntities(text).replace(/^\n+/, "").trimEnd();
}

/** A fenced block whose fence outruns any backtick run in the code, so it cannot close early. */
function fenced(code: string, lang: string): string {
  const longest = (code.match(/`{3,}/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2);
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${code}\n${fence}`;
}

// Code blocks wait in private-use placeholders while the rest converts, so no
// inline rule (bold, list item, whitespace collapse) can pull a fence mid-line
// or flatten indentation.
const CODE_SLOT = /\n*\uE000(\d+)\uE001\n*/g;

function htmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const stash = (code: string, lang: string): string => `\n\uE000${blocks.push(fenced(codeText(code), lang)) - 1}\uE001\n`;
  let md = html;

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c: string) => `\n# ${stripTags(c).trim()}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c: string) => `\n## ${stripTags(c).trim()}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c: string) => `\n### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c: string) => `\n#### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c: string) => `\n##### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c: string) => `\n###### ${stripTags(c).trim()}\n`);

  // Code blocks (pre > code) — extract language from class="language-xxx"
  md = md.replace(/<pre\b[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, attrs: string, code: string) => stash(code, /class="[^"]*language-(\w+)/.exec(attrs)?.[1] ?? ""));

  // Pre blocks without code wrapper
  md = md.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => stash(code, ""));

  // Inline code
  md = md.replace(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi, (_, c: string) => {
    const text = stripTags(c).trim();
    return text.includes("\n") ? text : `\`${text}\``;
  });

  // Links — allowlist scheme to block javascript:, data:, vbscript:, etc.
  md = md.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, rawHref: string, text: string) => {
    const linkText = stripTags(text).trim();
    if (!linkText) return "";
    const normalized = normalizeHref(rawHref);
    if (normalized === "" || normalized.startsWith("#")) return linkText;
    if (!isSafeHref(normalized)) return linkText;
    return `[${linkText}](${normalized})`;
  });

  // Bold
  md = md.replace(/<(?:strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c: string) => `**${stripTags(c).trim()}**`);

  // Italic
  md = md.replace(/<(?:em|i)(?:\s[^>]*)?>([\s\S]*?)<\/(?:em|i)>/gi, (_, c: string) => `*${stripTags(c).trim()}*`);

  // Lists
  md = md.replace(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi, (_, c: string) => `- ${stripTags(c).trim()}\n`);
  md = md.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Paragraphs and line breaks
  md = md.replace(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi, (_, c: string) => `\n${stripTags(c).trim()}\n`);
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Tables (basic support)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent: string) => {
    return convertTable(tableContent);
  });

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c: string) => {
    const text = stripTags(c).trim();
    return text.split("\n").map((line: string) => `> ${line}`).join("\n") + "\n";
  });

  // Definition lists
  md = md.replace(/<dt[^>]*>([\s\S]*?)<\/dt>/gi, (_, c: string) => `\n**${stripTags(c).trim()}**\n`);
  md = md.replace(/<dd[^>]*>([\s\S]*?)<\/dd>/gi, (_, c: string) => `: ${stripTags(c).trim()}\n`);

  // Remove remaining HTML tags
  md = stripTags(md);

  // Decode HTML entities
  md = decodeHtmlEntities(md);

  // Collapse excessive whitespace
  md = md.replace(/\n{4,}/g, "\n\n\n");
  md = md.replace(/[ \t]+/g, " ");
  md = md.replace(/^ +/gm, "");
  md = md.replace(CODE_SLOT, (_, i: string) => `\n\n${blocks[Number(i)] ?? ""}\n\n`);

  return md.trim();
}

/**
 * Opening tags per character, not counting <script>/<style> bodies: inline
 * hydration payloads (Next.js RSC, Nuxt) dilute a real HTML page below the
 * markdown threshold, so it was passed through raw and rejected as a blob.
 */
const SCRIPT_STYLE = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi;

export function markupDensity(text: string): number {
  const markup = text.replace(SCRIPT_STYLE, "");
  return (markup.match(/<[a-z]/gi) ?? []).length / Math.max(markup.length, 1);
}

/** Characters a reader sees: markup, script and style bodies, and whitespace left out. */
export function visibleTextLength(html: string): number {
  return stripTags(html.replace(SCRIPT_STYLE, "")).replace(/\s+/g, "").length;
}

/**
 * The main content area, unless it holds under a third of the page's text: a
 * content-class div can be just the lead paragraph (tailwindcss.com keeps its
 * install steps in sibling grid divs), and a stripped noise wrapper can take a
 * <main> tag with it (MDN). The body, already rid of nav and footer, has it all.
 */
function contentRegion(cleaned: string): string {
  const main = extractMainContent(cleaned);
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned)?.[1] ?? cleaned;
  return visibleTextLength(main) * 3 < visibleTextLength(body) ? body : main;
}

const NON_HTML_TYPE = /^\s*text\/(?:markdown|x-markdown|plain)\b/i;

/**
 * Whether a fetched body needs HTML-to-markdown conversion. A declared markdown
 * or plain-text type wins over tag density, so MDX with inline JSX stays intact.
 */
export function looksLikeHtml(text: string, contentType = ""): boolean {
  if (/^\s*<(?:!doctype\s+html|html)\b/i.test(text)) return true;
  if (NON_HTML_TYPE.test(contentType)) return false;
  return markupDensity(text) >= 0.005;
}

/**
 * Convert raw HTML to readable markdown documentation.
 * Extracts the main content area, strips noise, and converts to markdown.
 */
export function convertHtmlToMarkdown(html: string): string {
  if (!html || html.length < 50) return "";

  // Quick check: if content is already mostly markdown/plain text, return as-is
  if (!looksLikeHtml(html)) return html;

  // Strip DOCTYPE + entire <head>...</head> early so extractMainContent's body
  // fallback never returns these to the LLM. Without this, JS-rendered pages
  // (Next.js apps, Vite shells) leak `<!DOCTYPE html><html ...><head>...</head>`
  // when no <main>/<article>/content-div selector matches.
  let preCleaned = html.replace(/<!DOCTYPE\s+[^>]*>/gi, "");
  preCleaned = preCleaned.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");

  const cleaned = stripNoisyElements(preCleaned);
  const markdown = htmlToMarkdown(contentRegion(cleaned));

  // Filter out results that are too short (extraction failed)
  if (markdown.length < 100) return "";

  // Final guard: if structural HTML tags survived (eg. <html>/<body> from
  // unmatched body extraction), reject — sanitize.ts will also strip these
  // but rejecting here lets fetchDocs fall through to Jina Reader instead.
  const residualHtmlRatio = (markdown.match(/<(?:html|body|meta|link)\b/gi) ?? []).length;
  if (residualHtmlRatio > 0 && markdown.length < 500) return "";

  return markdown;
}

