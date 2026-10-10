import type { McpServer } from "@modelcontextprotocol/server";
import type { FetchResult } from "../types.js";
import { z } from "zod";
import { isIndexContent } from "../services/fetcher.js";
import { deepFetchForTopic } from "../services/deep-fetch.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence } from "../utils/evidence.js";
import { isExtractionAttempt, EXTRACTION_REFUSAL, safeguardPath } from "../utils/guard.js";
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
    .describe("Plain name ('nextjs'), GroundTruth ID, npm:/pypi: package, or docs URL"),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe("Specific subject, e.g. 'middleware'"),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("e.g. '15'"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Project root, to read the installed version"),
});

export function registerDocsTool(server: McpServer): void {
  server.registerTool(
    "gt_get_docs",
    {
      title: "Get Documentation",
      description: "Reference docs for one library, filtered to a topic. libraryId: a plain name ('nextjs'), GroundTruth ID, npm:/pypi: package, or a docs URL. Curated guidance: gt_best_practices. Code-only snippets: gt_snippets.",
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
            // safeguardPath throws on system and hidden paths: those skip detection.
            const detected = await Promise.resolve()
              .then(() => detectVersionFromLockfile(safeguardPath(projectPath), pkgName))
              .catch(() => null);
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
