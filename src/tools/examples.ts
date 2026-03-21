import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchWithTimeout } from "../services/fetcher.js";
import { docCache, diskDocCache } from "../services/cache.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";

const InputSchema = z.object({
  library: z.string().min(1).max(200)
    .describe("Library or package name to find examples for, e.g. 'drizzle-orm', 'tanstack/query', 'fastapi'"),
  pattern: z.string().max(300).optional()
    .describe("Specific usage pattern to search for, e.g. 'middleware', 'useMutation', 'auth guard'"),
  language: z.string().max(50).optional()
    .describe("Programming language filter: 'typescript', 'python', 'rust', 'go'"),
  maxResults: z.number().int().min(1).max(10).default(5)
    .describe("Number of code examples to return (default: 5, max: 10)"),
});

function githubAuthHeaders(): Record<string, string> {
  const token = process.env.GT_GITHUB_TOKEN;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

interface CodeSearchItem {
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

export function registerExamplesTool(server: McpServer): void {
  server.registerTool(
    "gt_examples",
    {
      title: "Find Real-World Code Examples",
      description: `Search GitHub for real-world usage examples of any library or pattern. Returns code snippets from popular open-source projects with repository attribution.

Requires GT_GITHUB_TOKEN env var for higher rate limits.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ library, pattern, language, maxResults }) => {
      if (isExtractionAttempt(library)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const queryParts: string[] = [];
      const searchTerm = pattern ? `${library} ${pattern}` : `import ${library}`;
      queryParts.push(searchTerm);
      if (language) queryParts.push(`language:${language}`);
      queryParts.push("-path:test -path:__test__ -path:spec -path:node_modules -path:.next");

      const query = queryParts.join(" ");
      const cacheKey = `gh-code-examples:${query}:${maxResults}`;

      const memCached = docCache.get(cacheKey);
      if (typeof memCached === "string") {
        return { content: [{ type: "text", text: memCached }] };
      }

      const diskCached = await diskDocCache.get(cacheKey);
      if (diskCached) {
        docCache.set(cacheKey, diskCached);
        return { content: [{ type: "text", text: diskCached }] };
      }

      try {
        const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${maxResults}&sort=indexed`;
        const headers = {
          ...githubAuthHeaders(),
          Accept: "application/vnd.github.text-match+json",
        };

        const res = await fetchWithTimeout(searchUrl, 15_000, headers);

        if (res.status === 403 || res.status === 429) {
          return {
            content: [{
              type: "text",
              text: "GitHub API rate limit reached. Set GT_GITHUB_TOKEN env var for higher limits (5000 req/hr).",
            }],
          };
        }

        if (!res.ok) {
          return {
            content: [{
              type: "text",
              text: `GitHub Code Search returned ${res.status}. Ensure GT_GITHUB_TOKEN is set.`,
            }],
          };
        }

        const data = await res.json() as {
          total_count: number;
          items: CodeSearchItem[];
        };

        if (!data.items || data.items.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No code examples found for "${library}"${pattern ? ` with pattern "${pattern}"` : ""}. Try a different search term.`,
            }],
          };
        }

        const lines: string[] = [
          `# Code Examples: ${library}${pattern ? ` — ${pattern}` : ""}`,
          `> Found ${data.total_count} results, showing top ${data.items.length}`,
          "",
          "---",
          "",
        ];

        for (const item of data.items) {
          const repo = item.repository;
          const stars = repo.stargazers_count ?? 0;

          lines.push(`## ${repo.full_name} ${stars > 0 ? `(${stars} stars)` : ""}`);
          lines.push(`> File: [\`${item.path}\`](${item.html_url})`);
          if (repo.description) lines.push(`> ${repo.description}`);
          lines.push("");

          if (item.text_matches && item.text_matches.length > 0) {
            for (const match of item.text_matches.slice(0, 2)) {
              const lang = language ?? (item.name.endsWith(".py") ? "python" : "typescript");
              lines.push("```" + lang);
              lines.push(sanitizeContent(match.fragment));
              lines.push("```");
              lines.push("");
            }
          }

          lines.push("---");
          lines.push("");
        }

        const result = withNotice(lines.join("\n"));

        const ttl = 60 * 60 * 1000;
        docCache.set(cacheKey, result, ttl);
        void diskDocCache.set(cacheKey, result, ttl);

        return {
          content: [{ type: "text", text: result }],
          structuredContent: {
            library,
            pattern,
            language,
            totalCount: data.total_count,
            results: data.items.map((i) => ({
              repo: i.repository.full_name,
              file: i.path,
              url: i.html_url,
              stars: i.repository.stargazers_count,
            })),
          },
        };
      } catch {
        return {
          content: [{
            type: "text",
            text: `Failed to search GitHub for "${library}" examples. Check network and GT_GITHUB_TOKEN.`,
          }],
        };
      }
    },
  );
}
