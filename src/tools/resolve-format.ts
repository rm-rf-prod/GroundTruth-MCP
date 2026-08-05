import type { LibraryMatch } from "../types.js";

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
    "Use the ID from one of these results with gt_get_docs.",
    "",
  ];

  for (const m of matches) {
    lines.push(`### ${m.name}`);
    lines.push(`- **ID**: \`${m.id}\``);
    if (m.description) lines.push(`- **Description**: ${m.description}`);
    lines.push(`- **Docs**: ${m.docsUrl}`);
    if (m.llmsFullTxtUrl) lines.push(`- **LLMs-full.txt**: ${m.llmsFullTxtUrl}`);
    if (m.llmsTxtUrl) lines.push(`- **LLMs.txt**: ${m.llmsTxtUrl}`);
    if (m.githubUrl) lines.push(`- **GitHub**: ${m.githubUrl}`);
    lines.push(`- **Source**: ${m.source}`);
    lines.push("");
  }

  return lines.join("\n");
}
