import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { fetchWithTimeout, githubAuthHeaders } from "../services/fetcher.js";
import { docCache, diskDocCache } from "../services/cache.js";
import { readCached } from "../services/http/swr.js";
import { singleFlight } from "../services/http/single-flight.js";
import { discardBody } from "../services/http/body.js";
import { isExtractionAttempt, EXTRACTION_REFUSAL, withToolTimeout } from "../utils/guard.js";
import { docsFallbackResponse, type ExamplesResponse } from "./examples-fallback.js";
import { renderCodeSearch, type CodeSearchItem } from "./examples-render.js";

const InputSchema = z.object({
  library: z.string().min(1).max(200),
  pattern: z.string().max(300).optional()
    .describe("e.g. 'useMutation'"),
  language: z.string().max(50).optional()
    .describe("e.g. 'typescript'"),
  maxResults: z.number().int().min(1).max(10).default(5),
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

/** A rendered search, or why there is none (the caller turns that into the docs fallback). */
type SearchOutcome = { response: ExamplesResponse } | { reason: string; emptyText?: string };

const inFlightSearches = new Map<string, Promise<SearchOutcome>>();

/**
 * One GitHub code search, cached when it found something. A cache miss and a
 * stale entry's background refresh share it, single-flight per cache key.
 */
async function searchCode(
  params: { library: string; pattern: string | undefined; language: string | undefined; maxResults: number },
  query: string,
  cacheKey: string,
): Promise<SearchOutcome> {
  const { library, pattern, language, maxResults } = params;
  // GitHub code search is authenticated-only: without a token the call
  // is a guaranteed 401/403. Skip straight to the docs-derived path
  // instead of spending a round trip to be told so.
  if (!process.env.GT_GITHUB_TOKEN) {
    return { reason: "GitHub code search needs GT_GITHUB_TOKEN — showing documentation-derived examples instead." };
  }
  try {
    const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${maxResults}&sort=indexed`;
    const res = await fetchWithTimeout(searchUrl, 15_000, {
      ...githubAuthHeaders(),
      Accept: "application/vnd.github.text-match+json",
    });

    if (!res.ok) {
      discardBody(res);
      return {
        reason: res.status === 403 || res.status === 429
          ? "GitHub API rate limit reached (set GT_GITHUB_TOKEN for 5000 req/hr)."
          : `GitHub code search unavailable (HTTP ${res.status} — it requires GT_GITHUB_TOKEN).`,
      };
    }

    const data = await res.json() as { total_count: number; items: CodeSearchItem[] };
    if (!data.items || data.items.length === 0) {
      return {
        reason: "GitHub code search returned no results.",
        emptyText: `No code examples found for "${library}"${pattern ? ` with pattern "${pattern}"` : ""}. Try a different search term.`,
      };
    }

    const { text, response } = renderCodeSearch({ library, pattern, language, totalCount: data.total_count, items: data.items });
    const ttl = 60 * 60 * 1000;
    docCache.set(cacheKey, text, ttl);
    void diskDocCache.set(cacheKey, text, ttl);
    return { response };
  } catch {
    return {
      reason: "GitHub code search failed (network error).",
      emptyText: `Failed to search GitHub for "${library}" examples. Check network and GT_GITHUB_TOKEN.`,
    };
  }
}

export function registerExamplesTool(server: McpServer): void {
  server.registerTool(
    "gt_examples",
    {
      title: "Find Real-World Code Examples",
      description: "Real-world usage of a library or pattern from public GitHub code, with repo links (needs GT_GITHUB_TOKEN, else official-docs examples). Snippets from the library's own docs: gt_snippets.",
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

          const search = (): Promise<SearchOutcome> =>
            singleFlight(inFlightSearches, cacheKey, () => searchCode({ library, pattern, language, maxResults }, query, cacheKey));
          const cached = await readCached(cacheKey, search);
          if (cached !== undefined) {
            return { content: [{ type: "text", text: cached }] };
          }

          const outcome = await search();
          if ("response" in outcome) return outcome.response;
          return docsFallbackResponse({
            library, pattern, language, maxResults, reason: outcome.reason,
            ...(outcome.emptyText !== undefined ? { emptyText: outcome.emptyText } : {}),
          });
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
