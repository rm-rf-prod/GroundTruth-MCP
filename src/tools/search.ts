import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { normalizeQueryYear } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { CACHE_TTLS, DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { withTelemetry } from "../services/telemetry.js";
import { docCache, diskDocCache } from "../services/cache.js";
import { hashContent } from "../services/fetcher.js";
import { collectSearchSources } from "../services/search/collect.js";
import { addWebSearchSources, type SearchSource } from "../services/search/fetch-topic.js";

// Re-exported so callers that reason about search sourcing (gt_compat, gt_migration)
// and the existing test mocks keep a single stable import path.
export { findTopicUrls } from "../services/search/topic-match.js";
export { searchMDN, webSearch } from "../services/search/engines.js";
export { isAuthoritativeUrl } from "../services/search/url-rank.js";

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe("Topic, e.g. 'WCAG 2.2 focus indicators'"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT),
});

const NO_RESULTS_HELP = [
  "**What to try next:**",
  "- Be more specific (e.g. 'React hooks best practices' instead of 'React')",
  "- Include the library name + topic (e.g. 'Next.js middleware authentication')",
  "- Try gt_resolve_library to find a specific library, then gt_get_docs",
  "- Try gt_get_docs with a direct URL as the libraryId",
].join("\n");

const joined = (results: SearchSource[]): string => results.map((r) => r.content).join("\n\n");

/**
 * Sources for a query, remembered under its normalized form so a repeat skips
 * every MDN, web-search and page round trip. A miss is not remembered: a
 * transient outage must not pin "no results".
 */
async function sourcesFor(query: string, tokens: number): Promise<SearchSource[]> {
  const key = `search-final:${hashContent(query.toLowerCase().replace(/\s+/g, " ").trim())}:${tokens}`;
  const cached = docCache.get(key) ?? (await diskDocCache.get(key));
  if (typeof cached === "string") {
    try {
      return JSON.parse(cached) as SearchSource[];
    } catch {
      // unreadable entry: source again
    }
  }

  const { results, webSearched } = await collectSearchSources(query, tokens);
  // Evidence-driven escalation — sources exist but combined coverage is weak:
  // add authoritative web sources once instead of shipping a thin answer.
  if (results.length > 0 && results.length < 3 && !webSearched && !checkEvidence(joined(results), query).ok) {
    await addWebSearchSources(query, results, Math.floor(tokens / 3), 2);
  }
  if (results.length > 0) {
    const json = JSON.stringify(results);
    docCache.set(key, json, CACHE_TTLS.SEARCH_RESULT);
    void diskDocCache.set(key, json, CACHE_TTLS.SEARCH_RESULT);
  }
  return results;
}

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    "gt_search",
    {
      title: "Search Any Topic",
      description: "Official docs and standards for a topic with no single library: web APIs, CSS, security, accessibility, protocols, infrastructure. One library named: gt_best_practices or gt_get_docs. Browser support: gt_compat. Real-world code: gt_examples.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query: rawQuery, tokens }) => {
      return withTelemetry("gt_search", async (ctx) => {
        const query = normalizeQueryYear(rawQuery);
        const results = await sourcesFor(query, tokens);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for: "${query}"\n\n${NO_RESULTS_HELP}` }],
          };
        }

        const combinedCheck = checkEvidence(joined(results), query);

        const header = [
          `# Search: ${query}`,
          `> Found ${results.length} source${results.length > 1 ? "s" : ""}`,
          "",
          "---",
          "",
        ].join("\n");
        const body = results
          .map((r) => `## ${r.source}\n> Source: ${r.url}\n\n${r.content}\n\n---\n`)
          .join("\n");
        const evidenceBlock = buildEvidenceBlock({
          sources: results.map((r) => ({ url: r.url })),
          topic: query,
          check: combinedCheck,
        });

        ctx.resolved = results.length > 0;
        return {
          content: [{ type: "text", text: header + body + evidenceBlock }],
          structuredContent: {
            query,
            sources: results.map((r) => ({ name: r.source, url: r.url, content: r.content })),
            evidence: {
              ok: combinedCheck.ok,
              matchRatio: combinedCheck.matchRatio,
              occurrences: combinedCheck.occurrences,
              verdict: combinedCheck.ok ? "strong" : combinedCheck.matchRatio > 0 ? "weak" : "miss",
            },
          },
        };
      });
    },
  );
}
