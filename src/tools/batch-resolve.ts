import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, withToolTimeout } from "../utils/guard.js";

const InputSchema = z.object({
  libraryNames: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(20)
    .describe("e.g. ['react', 'next', 'tailwind']"),
});

/** Returned when the whole pipeline exceeds the tool timeout — an actionable
 *  next step beats a hung call or an MCP-level timeout error. */
const TIMEOUT_RESPONSE = {
  content: [{ type: "text" as const, text: "Library resolution timed out. Retry with fewer names, or call gt_resolve_library one name at a time." }],
};

export function registerBatchResolveTool(server: McpServer): void {
  server.registerTool(
    "gt_batch_resolve",
    {
      title: "Batch Resolve Libraries",
      description: "Resolve 1-20 library names to IDs and docs URLs in one call, registry only. One name with npm/PyPI fallback: gt_resolve_library. Project dependencies: gt_auto_scan. Registry is Elastic-2.0: look up named libraries only, never enumerate.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryNames }) => {
      return withTelemetry("gt_batch_resolve", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
          const results = await Promise.all(
            libraryNames.map(async (name) => {
              // Per-item guard: one flagged name must not discard the other
              // legitimate results in the batch.
              if (isExtractionAttempt(name)) {
                return {
                  query: name,
                  found: false,
                  id: null,
                  name: null,
                  docsUrl: null,
                  source: null,
                  blocked: true,
                };
              }
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

          const lines = results.map((r) => {
            if (r.found) return `- **${r.name}** (${r.id}) — ${r.docsUrl}`;
            if ("blocked" in r && r.blocked) return `- **${r.query}** — ${EXTRACTION_REFUSAL}`;
            return `- **${r.query}** — not found in registry`;
          });

          const header = [
            `# Batch Resolution — ${found}/${results.length} resolved`,
            notFound.length > 0 ? `> Not found: ${notFound.join(", ")}` : "",
          ].filter(Boolean).join("\n") + "\n\n---\n\n";

          return {
            content: [{ type: "text", text: withNotice(header + lines.join("\n")) }],
            structuredContent: {
              total: results.length,
              found,
              results,
            },
          };
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
