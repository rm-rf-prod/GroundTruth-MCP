import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchGitHubContent, fetchGitHubReleases, fetchViaJina, fetchAsMarkdownRace } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { computeQualityScore } from "../utils/quality.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { resolveDynamic } from "../services/resolve.js";

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

const MIGRATION_PATHS = [
  "MIGRATION.md",
  "UPGRADING.md",
  "UPGRADE.md",
  "docs/migration.md",
  "docs/MIGRATION.md",
  "docs/upgrading.md",
  "docs/upgrade-guide.md",
  "CHANGELOG.md",
];

const MIGRATION_URL_SUFFIXES = [
  "/docs/migration",
  "/docs/upgrading",
  "/docs/upgrade",
  "/docs/guides/migration",
  "/docs/guides/upgrading",
  "/migration",
  "/upgrade",
];

export function registerMigrationTool(server: McpServer): void {
  server.registerTool(
    "gt_migration",
    {
      title: "Get Migration Guide",
      description: `Fetch migration guides, breaking changes, and upgrade instructions for a library. Targets MIGRATION.md, CHANGELOG, release notes, and upgrade docs.

Call gt_resolve_library first to get the libraryId.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ libraryId, fromVersion, toVersion, tokens }) => {
      if (isExtractionAttempt(libraryId)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);
      let docsUrl: string;
      let githubUrl: string | undefined;
      let displayName: string;
      let resolvedId: string;

      if (entry) {
        docsUrl = entry.docsUrl;
        githubUrl = entry.githubUrl;
        displayName = entry.name;
        resolvedId = entry.id;
      } else {
        const resolved = await resolveDynamic(libraryId);
        if (!resolved) {
          return {
            content: [{
              type: "text",
              text: `Could not resolve "${libraryId}". Try gt_resolve_library first to find the correct ID.`,
            }],
          };
        }
        docsUrl = resolved.docsUrl;
        githubUrl = resolved.githubUrl;
        displayName = resolved.displayName;
        resolvedId = libraryId;
      }

      const sections: Array<{ source: string; content: string }> = [];
      const topic = [
        "migration",
        "upgrade",
        "breaking changes",
        fromVersion ? `v${fromVersion.replace(/^v/, "")}` : "",
        toVersion ? `v${toVersion.replace(/^v/, "")}` : "",
      ].filter(Boolean).join(" ");

      if (githubUrl) {
        const migrationDocs = await Promise.allSettled(
          MIGRATION_PATHS.map(async (path) => {
            const result = await fetchGitHubContent(githubUrl, path);
            if (result && result.content.length > 200) {
              return { source: `GitHub: ${path}`, content: result.content };
            }
            throw new Error("no content");
          }),
        );

        for (const result of migrationDocs) {
          if (result.status === "fulfilled") {
            sections.push(result.value);
            if (sections.length >= 2) break;
          }
        }

        const releases = await fetchGitHubReleases(githubUrl);
        if (releases && releases.length > 200) {
          sections.push({ source: "GitHub Releases", content: releases });
        }
      }

      if (sections.length === 0) {
        try {
          const origin = new URL(docsUrl).origin;
          for (const suffix of MIGRATION_URL_SUFFIXES) {
            const url = `${origin}${suffix}`;
            const content = await fetchAsMarkdownRace(url);
            if (content && content.length > 300) {
              sections.push({ source: url, content });
              break;
            }
          }
        } catch { /* invalid URL */ }
      }

      if (sections.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No migration guides found for "${displayName}". Try gt_changelog for release notes, or gt_get_docs with topic "migration".`,
          }],
        };
      }

      const combined = sections
        .map((s) => `## ${s.source}\n\n${s.content}`)
        .join("\n\n---\n\n");

      const safe = sanitizeContent(combined);
      const { text, truncated } = extractRelevantContent(safe, topic, tokens);
      const qualityScore = computeQualityScore(text, topic, "github-readme");

      const header = [
        `# ${displayName} — Migration Guide`,
        fromVersion || toVersion
          ? `> ${fromVersion ? `From: v${fromVersion.replace(/^v/, "")}` : ""}${toVersion ? ` To: v${toVersion.replace(/^v/, "")}` : ""}`
          : "",
        `> Sources: ${sections.map((s) => s.source).join(", ")}`,
        truncated ? "> Note: Response truncated. Specify fromVersion/toVersion for focused results." : "",
        "",
        "---",
        "",
      ].filter(Boolean).join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + text) }],
        structuredContent: {
          libraryId: resolvedId,
          displayName,
          fromVersion,
          toVersion,
          sources: sections.map((s) => s.source),
          truncated,
          qualityScore,
          content: text,
        },
      };
    },
  );
}
