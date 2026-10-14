import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { lookupById, lookupByAlias, fuzzySearch } from "../sources/registry.js";
import { fetchDocs, fetchAsMarkdownRace, isIndexContent, rankIndexLinks, hashContent } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, withToolTimeout } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { resolveDynamic } from "../services/resolve.js";

const InputSchema = z.object({
  libraries: z
    .array(z.string().min(1).max(100))
    .min(2)
    .max(3)
    .describe("2-3 library names"),
  criteria: z
    .string()
    .max(300)
    .optional()
    .describe("e.g. 'bundle size'"),
  tokens: z
    .number()
    .int()
    .min(500)
    .max(4000)
    .default(2000),
});

export interface CompareTarget {
  id: string;
  name: string;
  description?: string | undefined;
  docsUrl: string;
  llmsTxtUrl?: string | undefined;
  llmsFullTxtUrl?: string | undefined;
}

async function resolveLibrary(name: string): Promise<CompareTarget | null> {
  const staticEntry = lookupById(name) ?? lookupByAlias(name) ?? fuzzySearch(name, 1)[0];
  if (staticEntry) {
    return {
      id: staticEntry.id,
      name: staticEntry.name,
      description: staticEntry.description,
      docsUrl: staticEntry.docsUrl,
      llmsTxtUrl: staticEntry.llmsTxtUrl,
      llmsFullTxtUrl: staticEntry.llmsFullTxtUrl,
    };
  }

  try {
    const dynamic = await resolveDynamic(name);
    if (dynamic) {
      return {
        id: name,
        name: dynamic.displayName,
        docsUrl: dynamic.docsUrl,
        llmsTxtUrl: dynamic.llmsTxtUrl,
        llmsFullTxtUrl: dynamic.llmsFullTxtUrl,
      };
    }
  } catch {
    // Dynamic fallback unavailable or resolution threw
  }

  return null;
}

/** Returned when the whole pipeline exceeds the tool timeout — an actionable
 *  next step beats a hung call or an MCP-level timeout error. */
const TIMEOUT_RESPONSE = {
  content: [{ type: "text" as const, text: "Comparison timed out. Retry with two libraries instead of three, or call gt_best_practices per library." }],
};

export function registerCompareTool(server: McpServer): void {
  server.registerTool(
    "gt_compare",
    {
      title: "Compare Libraries Side-by-Side",
      description: "Compare 2-3 libraries side by side from their live docs. Pass names (['prisma', 'drizzle-orm']), not IDs. One library: gt_get_docs.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraries, criteria, tokens }) => {
      return withTelemetry("gt_compare", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
          // No extraction guard on `criteria` — it is a comparison angle, not a
          // registry key ("full feature list" is a legitimate criteria).
          const angle = criteria ? `${criteria} comparison tradeoffs` : "overview features comparison";
          // Per-item guard: one flagged name is treated as unresolvable instead of
          // aborting the sibling libraries' comparison.
          const entries = await Promise.all(
            libraries.map(async (lib) => ({
              lib,
              entry: isExtractionAttempt(lib) ? null : await resolveLibrary(lib),
            })),
          );

          if (entries.every(({ entry }) => entry === null)) {
            const text = withNotice(
              `Could not resolve any of the requested libraries.\n\nTry using exact package names or registry IDs from \`gt_resolve_library\`.`,
            );
            return { content: [{ type: "text", text }] };
          }

          const fetchResults = await Promise.allSettled(
            entries.map(async ({ lib, entry }) => {
              // Name the peers: a bare angle spent zustand's budget on its Redux
              // and Valtio comparisons when the question was zustand vs jotai.
              const topic = `${libraries.filter((l) => l !== lib).join(" ")} ${angle}`;
              const cacheKey = `compare:${entry?.id ?? lib}:${hashContent(topic)}`;
              const cached = docCache.get(cacheKey);
              if (typeof cached === "string") return { lib, entry, content: cached };

              if (!entry) return { lib, entry: null, content: null };

              try {
                let fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl, topic);
                if (!fetchResult) return { lib, entry, content: null };
                if (isIndexContent(fetchResult.content)) {
                  const deepLinks = rankIndexLinks(fetchResult.content, topic, fetchResult.url || entry.docsUrl);
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
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
