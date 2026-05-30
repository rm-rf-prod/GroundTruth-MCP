import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchGitHubReleases, fetchGitHubContent, fetchAsMarkdownRace } from "../services/fetcher.js";
import { extractRelevantContent, sliceVersionBand } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { resolveDynamic } from "../services/resolve.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(200)
    .describe("Library ID from gt_resolve_library, e.g. 'vercel/next.js'"),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("Filter to a specific version prefix, e.g. '15' or 'v15.2.0'"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe("Max tokens for content"),
});

export function registerChangelogTool(server: McpServer): void {
  server.registerTool(
    "gt_changelog",
    {
      title: "Fetch Library Changelog",
      description: `Fetch recent release notes and changelog for a library. Reads GitHub Releases API first, then CHANGELOG.md, then the docs site. Use before upgrading.

Use this for "what changed in version X" questions. For "how do I upgrade my code from vA to vB" — use gt_migration instead (it targets MIGRATION.md, UPGRADING.md, and upgrade guides with step-by-step instructions).`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryId, version, tokens }) => {
      if (isExtractionAttempt(libraryId)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }
      if (version && isExtractionAttempt(version)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const cacheKey = `changelog:${libraryId}:${version ?? ""}:${tokens}`;
      const cached = docCache.get(cacheKey);
      if (typeof cached === "string") {
        return {
          content: [{ type: "text", text: cached }],
          structuredContent: { libraryId, version: version ?? null, cached: true },
        };
      }

      const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);
      let displayName: string;
      let githubUrl: string | undefined;
      let docsUrl: string;

      if (entry) {
        displayName = entry.name;
        githubUrl = entry.githubUrl;
        docsUrl = entry.docsUrl;
      } else {
        const resolved = await resolveDynamic(libraryId);
        if (!resolved) {
          return {
            content: [{
              type: "text",
              text: `Could not resolve "${libraryId}". Try gt_resolve_library first.`,
            }],
          };
        }
        displayName = resolved.displayName;
        githubUrl = resolved.githubUrl;
        docsUrl = resolved.docsUrl;
      }

      let raw: string | null = null;
      let sourceUrl = "";

      // 1. GitHub Releases API
      if (githubUrl) {
        raw = await fetchGitHubReleases(githubUrl);
        sourceUrl = `${githubUrl}/releases`;
      }

      // 2. CHANGELOG.md via raw GitHub
      if (!raw && githubUrl) {
        const result = await fetchGitHubContent(githubUrl, "CHANGELOG.md");
        if (result) {
          raw = result.content;
          sourceUrl = result.url;
        }
      }

      // 3. Fallback: docsUrl/changelog via Jina
      if (!raw) {
        raw = await fetchAsMarkdownRace(`${docsUrl}/changelog`);
        sourceUrl = `${docsUrl}/changelog`;
      }

      if (!raw || raw.trim().length < 50) {
        const text = withNotice(
          `No changelog found for **${displayName}**.\n\nCheck the GitHub releases page directly: ${githubUrl ?? docsUrl}`,
        );
        return { content: [{ type: "text", text }] };
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

      const header = [
        `# ${displayName} Changelog`,
        version ? `Filtered to: **${version}**` : "",
        `Source: ${sourceUrl}`,
        truncated ? "\n> Content truncated — use a specific version to narrow results." : "",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      const response = withNotice(`${header}\n\n${text}`);
      docCache.set(cacheKey, response);

      return {
        content: [{ type: "text", text: response }],
        structuredContent: {
          libraryId,
          displayName,
          version: version ?? null,
          sourceUrl,
          truncated,
        },
      };
    },
  );
}
