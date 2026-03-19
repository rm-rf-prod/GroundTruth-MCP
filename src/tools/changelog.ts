import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchGitHubReleases, fetchGitHubContent, fetchViaJina } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

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
    .describe("Filter to a specific version prefix, e.g. '15' or 'v14.0.0'"),
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
      description: `Fetch recent release notes and changelog for a library. Reads GitHub Releases API first, then CHANGELOG.md, then the docs site. Use before upgrading.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: z.object({
        libraryId: z.string(),
        displayName: z.string(),
        version: z.string().nullable(),
        sourceUrl: z.string(),
        truncated: z.boolean(),
      }),
    },
    async ({ libraryId, version, tokens }) => {
      if (isExtractionAttempt(libraryId)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }
      if (version && isExtractionAttempt(version)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const cacheKey = `changelog:${libraryId}:${version ?? ""}`;
      const cached = docCache.get(cacheKey);
      if (typeof cached === "string") {
        return {
          content: [{ type: "text", text: cached }],
          structuredContent: { libraryId, version: version ?? null, cached: true },
        };
      }

      const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);
      const displayName = entry?.name ?? libraryId;
      const githubUrl = entry?.githubUrl;
      const docsUrl = entry?.docsUrl ?? `https://${libraryId}`;

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
        raw = await fetchViaJina(`${docsUrl}/changelog`);
        sourceUrl = `${docsUrl}/changelog`;
      }

      if (!raw || raw.trim().length < 50) {
        const text = withNotice(
          `No changelog found for **${displayName}**.\n\nCheck the GitHub releases page directly: ${githubUrl ?? docsUrl}`,
        );
        return { content: [{ type: "text", text }] };
      }

      let content = sanitizeContent(raw);

      // Filter to requested version prefix
      if (version) {
        const vNorm = version.replace(/^v/, "");
        const lines = content.split("\n");
        const startIdx = lines.findIndex(
          (l) => l.includes(version) || l.includes(`v${vNorm}`) || l.includes(vNorm),
        );
        if (startIdx !== -1) {
          const nextHeading = lines.findIndex((l, i) => i > startIdx && /^#{1,3}\s/.test(l));
          content = lines.slice(startIdx, nextHeading !== -1 ? nextHeading : startIdx + 100).join("\n");
        }
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
