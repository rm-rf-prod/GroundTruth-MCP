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

function htmlToMarkdown(html: string): string {
  let md = html;

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c: string) => `\n# ${stripTags(c).trim()}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c: string) => `\n## ${stripTags(c).trim()}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c: string) => `\n### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c: string) => `\n#### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c: string) => `\n##### ${stripTags(c).trim()}\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c: string) => `\n###### ${stripTags(c).trim()}\n`);

  // Code blocks (pre > code) — extract language from class="language-xxx"
  md = md.replace(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, attrs: string, code: string) => {
      const langMatch = /class="[^"]*language-(\w+)/.exec(attrs);
      const lang = langMatch?.[1] ?? "";
      // No per-element entity decode — the single global pass at the end of
      // htmlToMarkdown handles it; decoding here AND there turned doubly-
      // escaped example text (&amp;lt;div&amp;gt;) into live tags.
      return `\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n`;
    },
  );

  // Pre blocks without code wrapper
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => {
    return `\n\`\`\`\n${stripTags(code).trim()}\n\`\`\`\n`;
  });

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => {
    const text = stripTags(c).trim();
    return text.includes("\n") ? text : `\`${text}\``;
  });

  // Links — allowlist scheme to block javascript:, data:, vbscript:, etc.
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, rawHref: string, text: string) => {
    const linkText = stripTags(text).trim();
    if (!linkText) return "";
    const normalized = normalizeHref(rawHref);
    if (normalized === "" || normalized.startsWith("#")) return linkText;
    if (!isSafeHref(normalized)) return linkText;
    return `[${linkText}](${normalized})`;
  });

  // Bold
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c: string) => `**${stripTags(c).trim()}**`);

  // Italic
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c: string) => `*${stripTags(c).trim()}*`);

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c: string) => `- ${stripTags(c).trim()}\n`);
  md = md.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c: string) => `\n${stripTags(c).trim()}\n`);
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

  return md.trim();
}

/**
 * Convert raw HTML to readable markdown documentation.
 * Extracts the main content area, strips noise, and converts to markdown.
 */
export function convertHtmlToMarkdown(html: string): string {
  if (!html || html.length < 50) return "";

  // Quick check: if content is already mostly markdown/plain text, return as-is
  const tagDensity = (html.match(/<[a-z]/gi) ?? []).length / Math.max(html.length, 1);
  if (tagDensity < 0.005) return html;

  // Strip DOCTYPE + entire <head>...</head> early so extractMainContent's body
  // fallback never returns these to the LLM. Without this, JS-rendered pages
  // (Next.js apps, Vite shells) leak `<!DOCTYPE html><html ...><head>...</head>`
  // when no <main>/<article>/content-div selector matches.
  let preCleaned = html.replace(/<!DOCTYPE\s+[^>]*>/gi, "");
  preCleaned = preCleaned.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");

  const cleaned = stripNoisyElements(preCleaned);
  const mainContent = extractMainContent(cleaned);
  const markdown = htmlToMarkdown(mainContent);

  // Filter out results that are too short (extraction failed)
  if (markdown.length < 100) return "";

  // Final guard: if structural HTML tags survived (eg. <html>/<body> from
  // unmatched body extraction), reject — sanitize.ts will also strip these
  // but rejecting here lets fetchDocs fall through to Jina Reader instead.
  const residualHtmlRatio = (markdown.match(/<(?:html|body|meta|link)\b/gi) ?? []).length;
  if (residualHtmlRatio > 0 && markdown.length < 500) return "";

  return markdown;
}

