import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { resolveDynamic } from "../services/resolve.js";
import { extractRelevantContent, sliceVersionBand } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, withToolTimeout } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { computeQualityScore } from "../utils/quality.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { withTelemetry } from "../services/telemetry.js";
import {
  fetchVersionGuide,
  fetchGitHubMigrationDocs,
  fetchConventionalUpgradeDocs,
  searchForUpgradeGuide,
  type MigrationSection,
} from "../services/migration-sources.js";

// Re-exported so the existing test import path stays valid.
export { filterReleasesByVersion } from "../utils/release-filter.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe("Plain name or GroundTruth ID, e.g. 'nextjs'"),
  fromVersion: z
    .string()
    .max(50)
    .optional()
    .describe("e.g. '15'"),
  toVersion: z
    .string()
    .max(50)
    .optional()
    .describe("e.g. '16'"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT),
});

/** Returned when the whole pipeline exceeds the tool timeout — an actionable
 *  next step beats a hung call or an MCP-level timeout error. */
const TIMEOUT_RESPONSE = {
  content: [{ type: "text" as const, text: "Migration lookup timed out. Retry with explicit fromVersion/toVersion, or call gt_changelog instead." }],
};

export function registerMigrationTool(server: McpServer): void {
  server.registerTool(
    "gt_migration",
    {
      title: "Get Migration Guide",
      description: "Upgrade guide between two versions of a library: breaking changes and required code changes. Release notes only: gt_changelog.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryId, fromVersion, toVersion, tokens }) => {
      return withTelemetry("gt_migration", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
          if (isExtractionAttempt(libraryId)) {
            return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
          }

          const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);
          const resolved = entry
            ? { docsUrl: entry.docsUrl, githubUrl: entry.githubUrl, displayName: entry.name, resolvedId: entry.id }
            : await resolveDynamic(libraryId).then((r) =>
                r ? { docsUrl: r.docsUrl, githubUrl: r.githubUrl, displayName: r.displayName, resolvedId: libraryId } : null,
              );
          if (!resolved) {
            return {
              content: [{
                type: "text",
                text: `Could not resolve "${libraryId}". Try gt_resolve_library first to find the correct ID.`,
              }],
            };
          }
          const { docsUrl, githubUrl, displayName, resolvedId } = resolved;

          const sections: MigrationSection[] = [];
          const topic = [
            "migration",
            "upgrade",
            "breaking changes",
            fromVersion ? `v${fromVersion.replace(/^v/, "")}` : "",
            toVersion ? `v${toVersion.replace(/^v/, "")}` : "",
          ].filter(Boolean).join(" ");

          if (toVersion) {
            const guide = await fetchVersionGuide(docsUrl, toVersion);
            if (guide) sections.push(guide);
          }

          if (githubUrl) {
            sections.push(...(await fetchGitHubMigrationDocs(githubUrl, fromVersion, toVersion)));
          }

          if (sections.length === 0) {
            const conventional = await fetchConventionalUpgradeDocs(docsUrl);
            if (conventional) sections.push(conventional);
          }

          if (!sections.some((s) => !s.source.includes("Releases"))) {
            const searched = await searchForUpgradeGuide(displayName, docsUrl, fromVersion, toVersion);
            if (searched) sections.unshift(searched);
          }

          if (sections.length === 0) {
            return {
              content: [{
                type: "text",
                text: `No migration guides found for "${displayName}". Try gt_changelog for release notes, or gt_get_docs with topic "migration".`,
              }],
            };
          }

          const combined = sections.map((s) => `## ${s.source}\n\n${s.content}`).join("\n\n---\n\n");

          // Slice to the requested version band BEFORE ranking — this is what stops
          // ancient sections (e.g. Next.js v8-v11) reaching the BM25 pass at all.
          const banded = (fromVersion || toVersion)
            ? sliceVersionBand(combined, fromVersion, toVersion)
            : combined;

          const { text, truncated } = extractRelevantContent(sanitizeContent(banded), topic, tokens);
          const targetVersions = [fromVersion, toVersion].filter((v): v is string => typeof v === "string" && v.length > 0);
          const { score: qualityScore, hints: qualityHints } = computeQualityScore(text, topic, "github-readme", targetVersions);

          const evidence = checkEvidence(text, topic);
          const header = [
            `# ${displayName} — Migration Guide`,
            fromVersion || toVersion
              ? `> ${fromVersion ? `From: v${fromVersion.replace(/^v/, "")}` : ""}${toVersion ? ` To: v${toVersion.replace(/^v/, "")}` : ""}`
              : "",
            `> Sources: ${sections.map((s) => s.source).join(", ")}`,
            truncated && !(fromVersion && toVersion)
              ? "> Note: More matching sections were truncated; specify fromVersion/toVersion to narrow the range."
              : "",
            qualityScore < 0.4 ? `> Quality: Low — ${qualityHints.join("; ") || "verify against the official upgrade guide."}` : "",
          ].filter(Boolean).join("\n") + "\n\n---\n\n";

          const evidenceBlock = buildEvidenceBlock({
            sources: sections.map((s) => ({ url: s.source })),
            topic,
            check: evidence,
          });

          return {
            content: [{ type: "text", text: withNotice(header + text + evidenceBlock) }],
            structuredContent: {
              libraryId: resolvedId,
              displayName,
              fromVersion,
              toVersion,
              sources: sections.map((s) => s.source),
              truncated,
              qualityScore,
              qualityHints,
              evidence: {
                ok: evidence.ok,
                matchRatio: evidence.matchRatio,
                occurrences: evidence.occurrences,
                verdict: evidence.ok ? "strong" : evidence.matchRatio > 0 ? "weak" : "miss",
              },
              content: text,
            },
          };
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
