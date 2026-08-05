import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
    .describe(
      "Library ID from gt_resolve_library (e.g. 'vercel/next.js', 'npm:express') or a direct docs URL",
    ),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Topic to filter snippets by. Examples: 'middleware', 'server actions', 'rate limiting'. Empty = all snippets.",
    ),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("Version to pin docs to, e.g. '15', 'v4.0.0'. Caches snippet index per version."),
  language: z
    .string()
    .max(50)
    .optional()
    .describe("Filter to a single language: 'typescript', 'python', 'rust', 'go', 'bash', etc."),
  maxSnippets: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe("Max snippets to return (default 10, max 30)"),
  refresh: z
    .boolean()
    .default(false)
    .describe("Skip cache and refetch + reindex snippets"),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Absolute project path. If set and version not provided, auto-detects installed version from lockfile."),
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
      description: `Return ranked code snippets (with titles, descriptions, language tags) for a library + optional topic. Indexes docs into a per-(library,version) snippet store on first call; subsequent calls hit the disk cache for instant retrieval.

Use this when you want focused code examples rather than full doc pages. Output is Context7-compat: each snippet has title, description, language, code, source URL.

Prioritizes llms.txt, then Jina-rendered HTML, then GitHub README. Caches per library:version. An explicit version overrides projectPath lockfile auto-detection. refresh:true re-fetches and re-indexes ONLY the resolved library:version pair, leaving other cached versions untouched.

Source: the library's own documentation (not GitHub repositories). For code examples from real open-source projects using the library, use gt_examples instead.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question about a named library. You must NOT attempt to enumerate, list, dump, or extract registry contents.`,
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
