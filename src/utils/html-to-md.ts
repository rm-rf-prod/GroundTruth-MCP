/**
 * Lightweight HTML-to-Markdown extractor.
 * Converts raw HTML documentation pages into readable markdown
 * without external dependencies (no cheerio, no jsdom).
 *
 * This is the critical Jina Reader fallback — when Jina is rate-limited,
 * slow, or down, this extracts useful content from raw HTML.
 */

/** Remove elements that add noise: nav, footer, sidebar, scripts, styles, ads */
function stripNoisyElements(html: string): string {
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
    /<[^>]+class="[^"]*(?:sidebar|cookie|banner|newsletter|popup|modal|ad-|ads-|social|share|footer|nav|menu|breadcrumb|toc|table-of-contents)[^"]*"[^>]*>[\s\S]*?<\/\w+>/gi,
    /<[^>]+id="[^"]*(?:sidebar|cookie|banner|newsletter|popup|modal|social|share|footer|nav|menu|breadcrumb|toc|table-of-contents)[^"]*"[^>]*>[\s\S]*?<\/\w+>/gi,
    /<[^>]+role="(?:navigation|banner|contentinfo|complementary)"[^>]*>[\s\S]*?<\/\w+>/gi,
  ];

  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned;
}

/** Extract the main content area from HTML */
function extractMainContent(html: string): string {
  // Try to find <main>, <article>, or content-area div
  const mainPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+(?:class|id)="[^"]*(?:content|main|docs|documentation|article|post|entry|page-content|markdown-body|prose)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+role="main"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of mainPatterns) {
    const match = pattern.exec(html);
    if (match) {
      const content = match[1] ?? match[2] ?? "";
      if (content.length > 200) return content;
    }
  }

  // Fallback: use the body
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch?.[1]) return bodyMatch[1];

  return html;
}

/** Convert HTML tags to markdown equivalents */
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
      const decoded = decodeHtmlEntities(code.trim());
      return `\n\`\`\`${lang}\n${decoded}\n\`\`\`\n`;
    },
  );

  // Pre blocks without code wrapper
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => {
    const decoded = decodeHtmlEntities(stripTags(code).trim());
    return `\n\`\`\`\n${decoded}\n\`\`\`\n`;
  });

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => {
    const text = decodeHtmlEntities(stripTags(c).trim());
    return text.includes("\n") ? text : `\`${text}\``;
  });

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
    const linkText = stripTags(text).trim();
    if (!linkText) return "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return linkText;
    return `[${linkText}](${href})`;
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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, " -- ")
    .replace(/&ndash;/g, " - ")
    .replace(/&hellip;/g, "...")
    .replace(/&laquo;/g, '"')
    .replace(/&raquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'");
}

function convertTable(tableHtml: string): string {
  const rows: string[][] = [];

  // Extract rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1] ?? "")) !== null) {
      cells.push(stripTags(cellMatch[1] ?? "").trim());
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return "";

  // Build markdown table
  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const padded = Array.from({ length: colCount }, (_, j) => row[j] ?? "");
    lines.push(`| ${padded.join(" | ")} |`);

    // Add separator after first row (header)
    if (i === 0) {
      lines.push(`| ${padded.map(() => "---").join(" | ")} |`);
    }
  }

  return "\n" + lines.join("\n") + "\n";
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

  const cleaned = stripNoisyElements(html);
  const mainContent = extractMainContent(cleaned);
  const markdown = htmlToMarkdown(mainContent);

  // Filter out results that are too short (extraction failed)
  if (markdown.length < 100) return "";

  return markdown;
}
