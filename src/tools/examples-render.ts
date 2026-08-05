import { withNotice } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import type { ExamplesResponse } from "./examples-fallback.js";

export interface CodeSearchItem {
  name: string;
  path: string;
  html_url: string;
  repository: {
    full_name: string;
    description?: string;
    stargazers_count?: number;
    html_url: string;
  };
  text_matches?: Array<{
    fragment: string;
    matches: Array<{ text: string; indices: number[] }>;
  }>;
}

export function renderCodeSearch(params: {
  library: string;
  pattern: string | undefined;
  language: string | undefined;
  totalCount: number;
  items: CodeSearchItem[];
}): { text: string; response: ExamplesResponse } {
  const { library, pattern, language, totalCount, items } = params;

  const lines: string[] = [
    `# Code Examples: ${library}${pattern ? ` — ${pattern}` : ""}`,
    `> Found ${totalCount} results, showing top ${items.length}`,
    "",
    "---",
    "",
  ];

  for (const item of items) {
    const repo = item.repository;
    const stars = repo.stargazers_count ?? 0;

    lines.push(`## ${repo.full_name} ${stars > 0 ? `(${stars} stars)` : ""}`);
    lines.push(`> File: [\`${item.path}\`](${item.html_url})`);
    if (repo.description) lines.push(`> ${repo.description}`);
    lines.push("");

    for (const match of item.text_matches?.slice(0, 2) ?? []) {
      const lang = language ?? (item.name.endsWith(".py") ? "python" : "typescript");
      lines.push("```" + lang);
      lines.push(sanitizeContent(match.fragment));
      lines.push("```");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  const text = withNotice(lines.join("\n"));
  return {
    text,
    response: {
      content: [{ type: "text", text }],
      structuredContent: {
        library,
        pattern,
        language,
        totalCount,
        results: items.map((i) => ({
          repo: i.repository.full_name,
          file: i.path,
          url: i.html_url,
          stars: i.repository.stargazers_count,
        })),
      },
    },
  };
}
