/** Strip page chrome and isolate the main content region before conversion. */
/** Remove elements that add noise: nav, footer, sidebar, scripts, styles, ads */
export function stripNoisyElements(html: string): string {
  // Remove script and style blocks entirely (including content)
  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Remove common noisy elements by tag
  const noisyTags = ["nav", "footer", "aside", "header"];
  for (const tag of noisyTags) {
    // Non-greedy: match the outermost tag (handles simple nesting)
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    cleaned = cleaned.replace(re, "");
  }

  // Remove elements by class/id that are typically noise
  const noisePatterns = [
    /<[^>]+class="[^"]*(?:sidebar|cookie|banner|newsletter|popup|modal|ad-|ads-|social|share|footer|nav|menu|breadcrumb|toc|table-of-contents)[^"]*"[^>]*>[\s\S]*?<\/[\w-]+>/gi,
    /<[^>]+id="[^"]*(?:sidebar|cookie|banner|newsletter|popup|modal|social|share|footer|nav|menu|breadcrumb|toc|table-of-contents)[^"]*"[^>]*>[\s\S]*?<\/[\w-]+>/gi,
    /<[^>]+role="(?:navigation|banner|contentinfo|complementary)"[^>]*>[\s\S]*?<\/[\w-]+>/gi,
  ];

  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned;
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

