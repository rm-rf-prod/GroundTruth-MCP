import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { resolveChangelogTarget, fetchChangelog } from "../services/changelog-sources.js";
import { extractRelevantContent, sliceVersionBand } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { computeQualityScore } from "../utils/quality.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, withToolTimeout } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT, SWR_STALE_TTL_MS } from "../constants.js";

const MISS_TTL_MS = 5 * 60_000;

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(200)
    .describe("Plain name or GroundTruth ID, e.g. 'nextjs'"),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("Version prefix filter, e.g. '15'"),
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
  content: [{ type: "text" as const, text: "Changelog fetch timed out. Retry, or open the library's GitHub releases page directly." }],
};

export function registerChangelogTool(server: McpServer): void {
  server.registerTool(
    "gt_changelog",
    {
      title: "Fetch Library Changelog",
      description: "Recent release notes for a library (GitHub Releases, CHANGELOG.md): what changed in a version. Step-by-step upgrade: gt_migration.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryId, version, tokens }) => {
      return withTelemetry("gt_changelog", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
          if (isExtractionAttempt(libraryId)) {
            return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
          }
          if (version && isExtractionAttempt(version)) {
            return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
          }

          const cacheKey = `changelog:${libraryId}:${version ?? ""}:${tokens}`;
          let expiresAt = Number.POSITIVE_INFINITY;
          const cached = docCache.get(cacheKey, { maxStaleMs: SWR_STALE_TTL_MS, onHit: (at) => { expiresAt = at; } });
          if (typeof cached === "string") {
            // Envelope, not a bare string: caching only the text made every
            // cache hit return a degraded structuredContent (no displayName,
            // sourceUrl, qualityScore or content). compat.ts already does this.
            try {
              const envelope = JSON.parse(cached) as {
                text?: string;
                structuredContent?: Record<string, unknown>;
              };
              // A remembered miss is never served stale: past its TTL, look again.
              const staleMiss = envelope.structuredContent?.["found"] === false && Date.now() > expiresAt;
              if (typeof envelope.text === "string" && envelope.structuredContent && !staleMiss) {
                return {
                  content: [{ type: "text", text: envelope.text }],
                  structuredContent: { ...envelope.structuredContent, cached: true },
                };
              }
            } catch {
              // Pre-envelope cache entry — fall through and refetch.
            }
          }

          const target = await resolveChangelogTarget(libraryId);
          if (typeof target === "string") {
            return { content: [{ type: "text", text: target }] };
          }
          const { displayName, githubUrl, docsUrl } = target;
          const { raw, sourceUrl } = await fetchChangelog(target);

          if (!raw || raw.trim().length < 50) {
            const text = withNotice(
              `No changelog found for **${displayName}**.\n\nCheck the GitHub releases page directly: ${githubUrl ?? docsUrl}`,
            );
            const structuredContent = { libraryId, displayName, version: version ?? null, sourceUrl, found: false };
            // Remembered briefly: each repeat re-ran about 2 s of GitHub and Jina lookups.
            docCache.set(cacheKey, JSON.stringify({ text, structuredContent }), MISS_TTL_MS);
            return { content: [{ type: "text", text }], structuredContent };
          }

          let content = sanitizeContent(raw);

          // Slice to the requested version band. Replaces a fragile first-match
          // includes() scan that could anchor on an unrelated mention of the number
          // and then grab a fixed 100-line window.
          if (version) {
            content = sliceVersionBand(content, version, version);
          }

          const { text, truncated } = extractRelevantContent(
            content,
            version ? `release ${version} changes` : "releases changes",
            tokens,
          );

          const { score: qualityScore, hints: qualityHints } = computeQualityScore(
            text,
            version ? `release ${version} changes` : "releases changes",
            "github-readme",
            version ? [version] : undefined,
          );
          const evidence = version ? checkEvidence(text, `v${version.replace(/^v/, "")} release`) : checkEvidence(text, "");

          const header = [
            `# ${displayName} Changelog`,
            version ? `Filtered to: **${version}**` : "",
            `Source: ${sourceUrl}`,
            truncated ? "\n> Content truncated — use a specific version to narrow results." : "",
            version && qualityScore < 0.4 ? `\n> Quality: Low — ${qualityHints.join("; ") || "the fetched changelog may not cover this version."}` : "",
            "",
          ]
            .filter(Boolean)
            .join("\n");

          const evidenceBlock = buildEvidenceBlock({
            sources: [{ url: sourceUrl, sourceType: "changelog" }],
            ...(version ? { topic: `v${version.replace(/^v/, "")} release`, check: evidence } : {}),
          });

          const response = withNotice(`${header}\n\n${text}${evidenceBlock}`);
          const structuredContent = {
            libraryId,
            displayName,
            version: version ?? null,
            sourceUrl,
            truncated,
            qualityScore,
            qualityHints,
            content: text,
          };
          docCache.set(cacheKey, JSON.stringify({ text: response, structuredContent }));

          return {
            content: [{ type: "text", text: response }],
            structuredContent,
          };
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}

