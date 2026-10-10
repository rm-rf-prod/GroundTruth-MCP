import type { LibraryMatch } from "../types.js";
import { sanitizeInline } from "../utils/sanitize.js";

/** Render resolver matches, or an actionable message when nothing matched. */
export function formatResults(matches: LibraryMatch[]): string {
  if (matches.length === 0) {
    return [
      "No libraries found matching that name.",
      "",
      "**What to try next:**",
      "- Check spelling and try common aliases (e.g. 'nextjs' instead of 'next.js')",
      "- Use gt_search for a freeform query (works for any topic, not just libraries)",
      "- Provide a direct docs URL to gt_get_docs (e.g. 'https://docs.example.com')",
      "- Try the npm/PyPI package name if this is a less-known library",
    ].join("\n");
  }

  const lines: string[] = [
    `Found ${matches.length} result${matches.length > 1 ? "s" : ""}.`,
    "",
    "Pass the ID to gt_best_practices or gt_get_docs.",
    "",
  ];

  for (const m of matches) {
    lines.push(`### ${m.name}`);
    lines.push(`- **ID**: \`${m.id}\``);
    if (m.description) lines.push(`- **Description**: ${sanitizeInline(m.description)}`);
    lines.push(`- **Docs**: ${sanitizeInline(m.docsUrl)}`);
    if (m.llmsFullTxtUrl) lines.push(`- **LLMs-full.txt**: ${m.llmsFullTxtUrl}`);
    if (m.llmsTxtUrl) lines.push(`- **LLMs.txt**: ${m.llmsTxtUrl}`);
    if (m.githubUrl) lines.push(`- **GitHub**: ${sanitizeInline(m.githubUrl)}`);
    lines.push(`- **Source**: ${m.source}`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Plain http(s) URLs only: package metadata can carry javascript:, file: or multi-line values. */
const httpUrl = (u: string | undefined): string | undefined =>
  u && /^https?:\/\/[^\s<>"'`]+$/i.test(u) && URL.canParse(u) ? u : undefined;

/** A match safe to return as structured data: publisher text flattened and redacted, URLs checked. */
export function safeMatch(m: LibraryMatch): LibraryMatch {
  const safe: LibraryMatch = {
    ...m,
    name: sanitizeInline(m.name, 100),
    description: sanitizeInline(m.description),
    docsUrl: httpUrl(m.docsUrl) ?? "",
    llmsTxtUrl: httpUrl(m.llmsTxtUrl),
    githubUrl: httpUrl(m.githubUrl),
  };
  const full = httpUrl(m.llmsFullTxtUrl);
  if (full === undefined) delete safe.llmsFullTxtUrl;
  else safe.llmsFullTxtUrl = full;
  return safe;
}
