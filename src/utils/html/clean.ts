import { replaceUntilStable } from "../replace-stable.js";

/** Strip page chrome and isolate the main content region before conversion. */
const NOISE_WORD = /(?:^|[-_])(?:sidebar|cookie|banner|newsletter|popup|modal|ads?|social|share|footer|nav|menu|breadcrumb|toc|table-of-contents)(?:$|[-_])/i;
/** Noise words after `has-`/`with-`/`no-` describe a wrapper (`has-sidebar`, `page-with-toc`), not the noise itself. */
const MODIFIER = /(?:^|[-_])(?:has|with|no)(?:[-_]|$)/i;
const NOISE_ROLE = /^(?:navigation|banner|contentinfo|complementary)$/i;
const CONTENT_TAGS = new Set(["main", "article", "body", "html"]);
const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "wbr"]);

function isNoisyTag(tag: string): boolean {
  const cls = /\sclass="([^"]*)"/i.exec(tag)?.[1] ?? "";
  const id = /\sid="([^"]*)"/i.exec(tag)?.[1] ?? "";
  const role = /\srole="([^"]*)"/i.exec(tag)?.[1] ?? "";
  return NOISE_ROLE.test(role) || [...cls.split(/\s+/), id].some((t) => t !== "" && NOISE_WORD.test(t.split(MODIFIER)[0] ?? ""));
}

/** Remove whole class/id/role-marked noise elements, tracking nesting depth of the same tag. */
function removeNoisyByAttr(html: string): string {
  const open = /<([a-z][\w-]*)\b[^>]*>/gi;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  // Tag names whose close scan hit EOF: later openers drop only their tag, so no rescan (quadratic otherwise).
  const unclosed = new Set<string>();
  while ((m = open.exec(html)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (m.index < last || CONTENT_TAGS.has(name) || !isNoisyTag(m[0])) continue;
    let end = m.index + m[0].length;
    if (!VOID_TAGS.has(name) && !m[0].endsWith("/>") && !unclosed.has(name)) {
      const tagRe = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
      tagRe.lastIndex = end;
      let depth = 1;
      let t: RegExpExecArray | null;
      while ((t = tagRe.exec(html)) !== null) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) break;
      }
      // Unclosed tag: drop only the opening tag, never the rest of the page.
      if (t) end = t.index + t[0].length;
      else unclosed.add(name);
    }
    // A wrapper like `has-sidebar` or `page-with-toc` can hold the article itself.
    if (/<(?:main|article)\b/i.test(html.slice(m.index + m[0].length, end))) continue;
    out += html.slice(last, m.index);
    last = end;
    open.lastIndex = end;
  }
  return out + html.slice(last);
}

/** Remove elements that add noise: nav, footer, sidebar, scripts, styles, ads */
export function stripNoisyElements(html: string): string {
  // Remove script and style blocks entirely (including content)
  let cleaned = replaceUntilStable(html, /<script[\s\S]*?<\/script\b[^>]*>/gi);
  cleaned = replaceUntilStable(cleaned, /<style[\s\S]*?<\/style\b[^>]*>/gi);
  cleaned = replaceUntilStable(cleaned, /<noscript[\s\S]*?<\/noscript\b[^>]*>/gi);

  // Remove common noisy elements by tag
  const noisyTags = ["nav", "footer", "aside", "header"];
  for (const tag of noisyTags) {
    // Non-greedy: match the outermost tag (handles simple nesting)
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    cleaned = cleaned.replace(re, "");
  }

  return removeNoisyByAttr(cleaned);
}

/**
 * Find the opening <div> matching openTagRegex, then scan forward tracking
 * <div>/</div> depth to return the fully balanced inner content. A lazy
 * [\s\S]*?<\/div> match stops at the FIRST nested close tag (a TOC box, a
 * callout) and silently drops the entire article after it. Returns null when
 * no balanced close exists (malformed HTML) so callers fall through.
 */
function extractBalancedDivContent(html: string, openTagRegex: RegExp): string | null {
  const openMatch = openTagRegex.exec(html);
  if (!openMatch) return null;
  const start = openMatch.index + openMatch[0].length;
  const tagScanner = /<div\b[^>]*>|<\/div>/gi;
  tagScanner.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagScanner.exec(html)) !== null) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return null;
}

/** Extract the main content area from HTML */
export function extractMainContent(html: string): string {
  // <main>/<article> close tags don't nest with themselves in practice, so a
  // lazy match is safe for them.
  const tagPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];
  for (const pattern of tagPatterns) {
    const match = pattern.exec(html);
    if (match) {
      const content = match[1] ?? "";
      if (content.length > 200) return content;
    }
  }

  // Content-area divs need depth tracking (see extractBalancedDivContent).
  const divOpenPatterns = [
    /<div[^>]+(?:class|id)="[^"]*(?:content|main|docs|documentation|article|post|entry|page-content|markdown-body|prose)[^"]*"[^>]*>/i,
    /<div[^>]+role="main"[^>]*>/i,
  ];
  for (const pattern of divOpenPatterns) {
    const content = extractBalancedDivContent(html, pattern);
    if (content !== null && content.length > 200) return content;
  }

  // Fallback: use the body
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch?.[1]) return bodyMatch[1];

  return html;
}

