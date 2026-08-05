import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { fetchWithTimeout, githubAuthHeaders } from "../services/fetcher.js";
import { docCache, diskDocCache } from "../services/cache.js";
import { isExtractionAttempt, EXTRACTION_REFUSAL, withToolTimeout } from "../utils/guard.js";
import { docsFallbackResponse } from "./examples-fallback.js";
import { renderCodeSearch, type CodeSearchItem } from "./examples-render.js";

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

/** Returned when the whole pipeline exceeds the tool timeout — an actionable
 *  next step beats a hung call or an MCP-level timeout error. */
const TIMEOUT_RESPONSE = {
  content: [{ type: "text" as const, text: "Example search timed out. Retry, or call gt_get_docs with the same pattern as the topic." }],
};

function buildQuery(library: string, pattern: string | undefined, language: string | undefined): string {
  const parts = [pattern ? `${library} ${pattern}` : `import ${library}`];
  if (language) parts.push(`language:${language}`);
  parts.push("-path:test -path:__test__ -path:spec -path:node_modules -path:.next");
  // Exclude documentation/markdown files — gt_examples is for real code, not
  // READMEs/API.md (which GitHub code search otherwise returns as top hits).
  parts.push("-extension:md -extension:mdx -extension:markdown -extension:rst -extension:txt");
  return parts.join(" ");
}

export function registerExamplesTool(server: McpServer): void {
  server.registerTool(
    "gt_examples",
    {
      title: "Find Real-World Code Examples",
      description: `Search GitHub for real-world usage examples of any library or pattern. Returns code snippets from popular open-source projects with repository attribution.

Requires GT_GITHUB_TOKEN env var for higher rate limits (5000 req/hr vs 60 unauthenticated).

Source: open-source GitHub repositories (not the library's own docs). Use this when you want to see how real projects use a library. For code snippets extracted from the library's own documentation, use gt_snippets instead.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ library, pattern, language, maxResults }) => {
      return withTelemetry("gt_examples", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
          if (isExtractionAttempt(library)) {
            return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
          }

          const query = buildQuery(library, pattern, language);
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

          const fallback = (reason: string, emptyText?: string) =>
            docsFallbackResponse({
              library, pattern, language, maxResults, reason,
              ...(emptyText !== undefined ? { emptyText } : {}),
            });

          // GitHub code search is authenticated-only: without a token the call
          // is a guaranteed 401/403. Skip straight to the docs-derived path
          // instead of spending a round trip to be told so.
          if (!process.env.GT_GITHUB_TOKEN) {
            return fallback("GitHub code search needs GT_GITHUB_TOKEN — showing documentation-derived examples instead.");
          }

          try {
            const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${maxResults}&sort=indexed`;
            const res = await fetchWithTimeout(searchUrl, 15_000, {
              ...githubAuthHeaders(),
              Accept: "application/vnd.github.text-match+json",
            });

            if (!res.ok) {
              return fallback(
                res.status === 403 || res.status === 429
                  ? "GitHub API rate limit reached (set GT_GITHUB_TOKEN for 5000 req/hr)."
                  : `GitHub code search unavailable (HTTP ${res.status} — it requires GT_GITHUB_TOKEN).`,
              );
            }

            const data = await res.json() as { total_count: number; items: CodeSearchItem[] };
            if (!data.items || data.items.length === 0) {
              return fallback(
                "GitHub code search returned no results.",
                `No code examples found for "${library}"${pattern ? ` with pattern "${pattern}"` : ""}. Try a different search term.`,
              );
            }

            const { text, response } = renderCodeSearch({
              library,
              pattern,
              language,
              totalCount: data.total_count,
              items: data.items,
            });
            const ttl = 60 * 60 * 1000;
            docCache.set(cacheKey, text, ttl);
            void diskDocCache.set(cacheKey, text, ttl);
            return response;
          } catch {
            return fallback(
              "GitHub code search failed (network error).",
              `Failed to search GitHub for "${library}" examples. Check network and GT_GITHUB_TOKEN.`,
            );
          }
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
