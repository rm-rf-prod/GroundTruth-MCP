import type { McpServer } from "@modelcontextprotocol/server";
import type { Snippet } from "../types.js";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { snippetStore } from "../services/snippet-store.js";
import { buildIndex } from "../services/snippets/build-index.js";
import { rankSnippets } from "../utils/snippet-extract.js";
import { isExtractionAttempt, EXTRACTION_REFUSAL, withToolTimeout } from "../utils/guard.js";
import { detectVersionFromLockfile } from "../utils/lockfile.js";
import { resolveLibraryEntry, resolveSnippetTarget } from "./snippets-resolve.js";
import { renderNoIndex, renderNoTopicMatch, renderSnippetResult } from "./snippets-report.js";

// Re-exported so gt_examples and the existing tests keep one stable import path.
export { buildIndex } from "../services/snippets/build-index.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe("Plain name, GroundTruth ID, or docs URL"),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe("Filter, e.g. 'middleware'. Empty = all."),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("e.g. '15'"),
  language: z
    .string()
    .max(50)
    .optional()
    .describe("e.g. 'typescript'"),
  maxSnippets: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10),
  refresh: z
    .boolean()
    .default(false)
    .describe("Re-fetch and re-index"),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Project root, to read the installed version"),
});

/** Returned when the whole pipeline exceeds the tool timeout — an actionable
 *  next step beats a hung call or an MCP-level timeout error. */
const TIMEOUT_RESPONSE = {
  content: [{ type: "text" as const, text: "Snippet indexing timed out. Retry, or call gt_get_docs with the same topic." }],
};

export function registerSnippetsTool(server: McpServer): void {
  server.registerTool(
    "gt_snippets",
    {
      title: "Get Code Snippets",
      description: "Ranked code snippets (title, language, code, source URL) from a library's own docs, by topic and language. Cached per version; refresh:true re-indexes. Prose docs: gt_get_docs. Real-project usage: gt_examples.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryId, topic = "", version, language, maxSnippets, refresh, projectPath }) => {
      return withTelemetry("gt_snippets", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
          // Guard only the resolution identifier (see docs.ts) — topic is a
          // content filter, not a registry key.
          if (isExtractionAttempt(libraryId)) {
            return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
          }

          const entry = resolveLibraryEntry(libraryId);
          if (!version && projectPath && entry) {
            const pkgName = entry.npmPackage ?? entry.pypiPackage ?? entry.id.split("/").pop() ?? "";
            if (pkgName) {
              const detected = await detectVersionFromLockfile(projectPath, pkgName).catch(() => null);
              if (detected) version = detected;
            }
          }

          const target = resolveSnippetTarget(libraryId);
          if (typeof target === "string") {
            return { content: [{ type: "text", text: target }] };
          }
          const { library, displayName, docsUrl } = target;
          const versionKey = version ?? null;

          let snippets: Snippet[] = [];
          let sourceUrl = docsUrl;
          let builtAt = new Date().toISOString();
          let fromCache = false;

          if (!refresh) {
            const cached = await snippetStore.query(library, versionKey, topic, language, maxSnippets);
            if (cached && cached.snippets.length > 0) {
              snippets = cached.snippets;
              sourceUrl = cached.sourceUrl;
              builtAt = cached.builtAt;
              fromCache = true;
            }
          }

          if (snippets.length === 0) {
            const index = await buildIndex(
              library, version, docsUrl, target.llmsTxtUrl, target.llmsFullTxtUrl, target.githubUrl, topic,
            );

            // Merge with whatever the store already holds for this library:version.
            // Topic-directed traversal indexes different pages per topic — the
            // union accumulates coverage instead of each rebuild wiping the last.
            if (index) {
              // refresh:true is documented as a clean rebuild — merging with the
              // old disk index would carry deleted upstream snippets forever.
              const existing = refresh ? null : await snippetStore.load(library, versionKey);
              if (existing && existing.snippets.length > 0) {
                const byId = new Map(existing.snippets.map((s) => [s.id, s]));
                for (const s of index.snippets) byId.set(s.id, s);
                index.snippets = [...byId.values()].slice(-500);
              }
            }

            if (!index || index.snippets.length === 0) return renderNoIndex(displayName);

            await snippetStore.save(index);
            snippets = rankSnippets(index.snippets, topic, language, maxSnippets);
            sourceUrl = index.sourceUrl;
            builtAt = index.builtAt;

            if (snippets.length === 0) {
              return renderNoTopicMatch({ index, displayName, library, topic, version, language });
            }
          }

          return renderSnippetResult({
            snippets, library, displayName, topic, version, language, sourceUrl, builtAt, fromCache,
          });
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
