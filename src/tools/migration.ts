import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
    .describe("Library ID from gt_resolve_library (e.g. 'vercel/next.js')"),
  fromVersion: z
    .string()
    .max(50)
    .optional()
    .describe("Version migrating from, e.g. '14', 'v3.0'"),
  toVersion: z
    .string()
    .max(50)
    .optional()
    .describe("Version migrating to, e.g. '15', 'v4.0'"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe("Max tokens to return"),
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
      description: `Fetch migration guides, breaking changes, and upgrade instructions for a library. Targets MIGRATION.md, UPGRADING.md, CHANGELOG, release notes, and upgrade docs.

Call gt_resolve_library first to get the libraryId.

Use this when the user asks HOW to upgrade their code from one version to another (step-by-step migration instructions, breaking changes, code transforms needed). For "what changed in version X" release notes without upgrade instructions, use gt_changelog instead.`,
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
            truncated ? "> Note: Response truncated. Specify fromVersion/toVersion for focused results." : "",
            qualityScore < 0.4 ? `> Quality: Low — ${qualityHints.join("; ") || "verify against the official upgrade guide."}` : "",
            "",
            "---",
            "",
          ].filter(Boolean).join("\n");

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
