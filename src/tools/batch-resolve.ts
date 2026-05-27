import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";

const InputSchema = z.object({
  libraryNames: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(20)
    .describe("Array of library names to resolve (max 20). Example: ['react', 'next', 'tailwind']"),
});

export function registerBatchResolveTool(server: McpServer): void {
  server.registerTool(
    "gt_batch_resolve",
    {
      title: "Batch Resolve Libraries",
      description: `Resolve multiple library names to IDs and docs URLs in a single call. Returns results for each library. Max 20 per call.

Use this when you already have a list of library names and need to batch-resolve them to IDs efficiently (e.g. before calling gt_get_docs for each). Registry-only lookup — no external npm/PyPI/crates fallback. For a single library with external fallback, use gt_resolve_library instead. For scanning a project's actual dependency files and fetching best practices, use gt_auto_scan instead.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryNames }) => {
      for (const name of libraryNames) {
        if (isExtractionAttempt(name)) {
          return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
        }
      }

      const results = await Promise.all(
        libraryNames.map(async (name) => {
          const alias = lookupByAlias(name);
          if (alias) {
            return {
              query: name,
              found: true,
              id: alias.id,
              name: alias.name,
              docsUrl: alias.docsUrl,
              source: "registry" as const,
            };
          }

          const fuzzy = fuzzySearch(name, 1);
          if (fuzzy.length > 0 && fuzzy[0]) {
            return {
              query: name,
              found: true,
              id: fuzzy[0].id,
              name: fuzzy[0].name,
              docsUrl: fuzzy[0].docsUrl,
              source: "registry" as const,
            };
          }

          return {
            query: name,
            found: false,
            id: null,
            name: null,
            docsUrl: null,
            source: null,
          };
        }),
      );

      const found = results.filter((r) => r.found).length;
      const notFound = results.filter((r) => !r.found).map((r) => r.query);

      const lines = results.map((r) =>
        r.found
          ? `- **${r.name}** (${r.id}) — ${r.docsUrl}`
          : `- **${r.query}** — not found in registry`,
      );

      const header = [
        `# Batch Resolution — ${found}/${results.length} resolved`,
        notFound.length > 0 ? `> Not found: ${notFound.join(", ")}` : "",
        "",
        "---",
        "",
      ].filter(Boolean).join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + lines.join("\n")) }],
        structuredContent: {
          total: results.length,
          found,
          results,
        },
      };
    },
  );
}
