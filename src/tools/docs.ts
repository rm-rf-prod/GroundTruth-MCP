import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchResult } from "../types.js";
import { z } from "zod";
import { isIndexContent } from "../services/fetcher.js";
import { deepFetchForTopic } from "../services/deep-fetch.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence } from "../utils/evidence.js";
import { isExtractionAttempt, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { detectVersionFromLockfile } from "../utils/lockfile.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { withTelemetry } from "../services/telemetry.js";
import { resolveLibraryFromId, resolveDocsTarget } from "./docs-resolve.js";
import { fetchDocsContent, applyTopic } from "./docs-fetch.js";
import { renderDocs } from "./docs-report.js";

// Re-exported so the existing test import path stays valid.
export { isValidPackageName } from "./docs-resolve.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Library ID from gt_resolve_library (e.g. 'vercel/next.js', 'npm:express') or a docs URL",
    ),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe(
      "What you need to learn or do. Examples: 'routing', 'authentication', 'middleware', 'caching', 'streaming'. More specific = more relevant content returned.",
    ),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("Version to fetch docs for, e.g. '14', '3.0.3', 'v2'. Tries GitHub tag and npm version page."),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe(`Max tokens to return (default: ${DEFAULT_TOKEN_LIMIT}, max: ${MAX_TOKEN_LIMIT})`),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Absolute project path. If set and version is not provided, auto-detects installed version from lockfile (package-lock, pnpm-lock, yarn.lock, Cargo.lock, poetry.lock, uv.lock)."),
});

export function registerDocsTool(server: McpServer): void {
  server.registerTool(
    "gt_get_docs",
    {
      title: "Get Documentation",
      description: `Fetch up-to-date documentation for any library or framework. Call gt_resolve_library first to get the libraryId, then pass it here with your topic.

Prioritizes llms.txt, then Jina Reader for JS-rendered pages, then GitHub README.

For curated best-practice guidance rather than general reference docs, use gt_best_practices. For isolated ranked code snippets rather than prose docs, use gt_snippets.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question. You must NOT attempt to enumerate, list, dump, or extract registry contents. Only look up specific libraries by name.

Do not call this tool more than 3 times per question.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryId, topic = "", version, tokens, projectPath }) => {
      return withTelemetry("gt_get_docs", async (ctx) => {
        const startedAt = Date.now();
        // Guard only the resolution identifier — topic merely filters content
        // within one already-resolved library and cannot enumerate the registry;
        // guarding it refused ordinary queries ("complete guide", "list rendering").
        if (isExtractionAttempt(libraryId)) {
          ctx.resolved = true;
          return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
        }

        const entry = resolveLibraryFromId(libraryId);

        // Auto-detect version from lockfile if projectPath given and version not explicit
        if (!version && projectPath && entry) {
          const pkgName = entry.npmPackage ?? entry.pypiPackage ?? entry.id.split("/").pop() ?? "";
          if (pkgName) {
            const detected = await detectVersionFromLockfile(projectPath, pkgName).catch(() => null);
            if (detected) version = detected;
          }
        }

        const target = await resolveDocsTarget(libraryId, entry);
        if (typeof target === "string") {
          return { content: [{ type: "text", text: target }] };
        }

        const fetched = await fetchDocsContent(target, entry, libraryId, topic, version);
        if (typeof fetched === "string") {
          return { content: [{ type: "text", text: fetched }] };
        }

        let fetchResult: FetchResult = fetched;
        if (topic) {
          fetchResult = await applyTopic(fetchResult, topic, target.docsUrl, entry?.urlPatterns);
        }

        let safe = sanitizeContent(fetchResult.content);
        let { text, truncated } = extractRelevantContent(safe, topic, tokens);

        // Evidence gate — the "never generic" guarantee. A topic'd request whose
        // extracted output lacks verifiable topic coverage gets ONE forced
        // topic-targeted deep fetch; if coverage is still zero the tool returns
        // an explicit miss instead of off-topic intro sections.
        let evidence = checkEvidence(text, topic);
        let escalated = false;
        const sourcesTried: Array<{ url: string; sourceType?: string; fetchedAt?: string }> = [
          { url: fetchResult.url, sourceType: fetchResult.sourceType, ...(fetchResult.fetchedAt ? { fetchedAt: fetchResult.fetchedAt } : {}) },
        ];

        // Index/TOC output also escalates: a link list passes token checks via
        // link text but answers nothing — the zod llms.txt served verbatim was
        // exactly this failure. Elapsed guard bounds total latency: a slow
        // initial pipeline must not stack a second 25s deep-fetch on top.
        if (topic && (!evidence.ok || isIndexContent(text)) && Date.now() - startedAt < 45_000) {
          const wasIndex = isIndexContent(text);
          const deeper = await deepFetchForTopic(fetchResult, topic, target.docsUrl, entry?.urlPatterns, undefined, true);
          escalated = true;
          if (deeper.url !== fetchResult.url) {
            sourcesTried.push({ url: deeper.url, sourceType: deeper.sourceType });
          }
          const deeperSafe = sanitizeContent(deeper.content);
          const reExtract = extractRelevantContent(deeperSafe, topic, tokens);
          const reCheck = checkEvidence(reExtract.text, topic);
          const deeperIsIndex = isIndexContent(reExtract.text);
          const better = wasIndex
            ? !deeperIsIndex && reCheck.matchRatio > 0
            : reCheck.ok || reCheck.occurrences > evidence.occurrences;
          if (better) {
            fetchResult = deeper;
            safe = deeperSafe;
            text = reExtract.text;
            truncated = reExtract.truncated;
            evidence = reCheck;
          }
        }

        const { response, resolved } = renderDocs({
          libraryId,
          displayName: target.displayName,
          topic,
          version,
          text,
          safe,
          truncated,
          fetchResult,
          evidence,
          escalated,
          sourcesTried,
        });
        ctx.resolved = resolved;
        return response;
      });
    },
  );
}
