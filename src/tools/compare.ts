import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias, fuzzySearch } from "../sources/registry.js";
import { fetchDocs, fetchAsMarkdownRace, isIndexContent, rankIndexLinks } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import type { LibraryEntry } from "../types.js";

const InputSchema = z.object({
  libraries: z
    .array(z.string().min(1).max(100))
    .min(2)
    .max(3)
    .describe("2–3 library names to compare, e.g. ['prisma', 'drizzle-orm']"),
  criteria: z
    .string()
    .max(300)
    .optional()
    .describe("Comparison angle: 'performance', 'TypeScript support', 'bundle size', 'DX'"),
  tokens: z
    .number()
    .int()
    .min(500)
    .max(4000)
    .default(2000)
    .describe("Max tokens per library (2000 default)"),
});

function resolveLibrary(name: string): LibraryEntry | null {
  return lookupById(name) ?? lookupByAlias(name) ?? fuzzySearch(name, 1)[0] ?? null;
}

export function registerCompareTool(server: McpServer): void {
  server.registerTool(
    "gt_compare",
    {
      title: "Compare Libraries Side-by-Side",
      description: `Compare 2–3 libraries side-by-side. Fetches live documentation for each and presents content relevant to the comparison criteria.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraries, criteria, tokens }) => {
      for (const lib of libraries) {
        if (isExtractionAttempt(lib)) {
          return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
        }
      }
      if (criteria && isExtractionAttempt(criteria)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const topic = criteria ? `${criteria} comparison tradeoffs` : "overview features comparison";
      const entries = libraries.map((lib) => ({ lib, entry: resolveLibrary(lib) }));

      if (entries.every(({ entry }) => entry === null)) {
        const text = withNotice(
          `Could not resolve any of the requested libraries.\n\nTry using exact package names or registry IDs from \`gt_resolve_library\`.`,
        );
        return { content: [{ type: "text", text }] };
      }

      const fetchResults = await Promise.allSettled(
        entries.map(async ({ lib, entry }) => {
          const cacheKey = `compare:${entry?.id ?? lib}:${topic.slice(0, 40)}`;
          const cached = docCache.get(cacheKey);
          if (typeof cached === "string") return { lib, entry, content: cached };

          if (!entry) return { lib, entry: null, content: null };

          try {
            let fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl, topic);
            if (!fetchResult) return { lib, entry, content: null };
            if (isIndexContent(fetchResult.content)) {
              const deepLinks = rankIndexLinks(fetchResult.content, topic);
              for (const deepUrl of deepLinks) {
                const deepContent = await fetchAsMarkdownRace(deepUrl);
                if (deepContent && deepContent.length > 300) {
                  fetchResult = { content: deepContent, url: deepUrl, sourceType: "jina" };
                  break;
                }
              }
            }
            const safe = sanitizeContent(fetchResult.content);
            const { text } = extractRelevantContent(safe, topic, tokens ?? 2000);
            docCache.set(cacheKey, text);
            return { lib, entry, content: text };
          } catch {
            return { lib, entry, content: null };
          }
        }),
      );

      const sections: string[] = [];
      const structuredLibraries: Array<{
        id: string;
        name: string;
        description: string;
        docsUrl: string;
        content: string;
      }> = [];

      for (const result of fetchResults) {
        if (result.status !== "fulfilled") continue;
        const { lib, entry, content } = result.value;
        const name = entry?.name ?? lib;
        const id = entry?.id ?? lib;
        const description = entry?.description ?? "";
        const docsUrl = entry?.docsUrl ?? "";
        const displayContent = content ?? `_No documentation found for ${name}._`;

        sections.push(`## ${name}\n\n${description ? `> ${description}\n\n` : ""}${displayContent}`);
        structuredLibraries.push({ id, name, description, docsUrl, content: displayContent });
      }

      if (sections.length === 0) {
        const text = withNotice(
          `Could not resolve any of the requested libraries.\n\nTry using exact package names or registry IDs from \`gt_resolve_library\`.`,
        );
        return { content: [{ type: "text", text }] };
      }

      const header = [
        `# Comparison: ${libraries.join(" vs ")}`,
        criteria ? `Criteria: **${criteria}**` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      const response = withNotice(`${header}\n\n${sections.join("\n\n---\n\n")}`);

      return {
        content: [{ type: "text", text: response }],
        structuredContent: {
          libraries: structuredLibraries,
          criteria: criteria ?? "general overview",
        },
      };
    },
  );
}
