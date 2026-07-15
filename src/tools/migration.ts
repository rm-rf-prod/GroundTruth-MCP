import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchGitHubContent, fetchGitHubReleases, fetchAsMarkdownRace } from "../services/fetcher.js";
import { extractRelevantContent, sliceVersionBand, parseMajor } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { computeQualityScore } from "../utils/quality.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { resolveDynamic } from "../services/resolve.js";
import { webSearch, isAuthoritativeUrl } from "./search.js";

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

// NOTE: CHANGELOG.md is intentionally excluded — it is a monolithic all-history
// release log that floods extraction with version-irrelevant entries. Use
// gt_changelog for release notes. sliceVersionBand trims the remaining docs.
const MIGRATION_PATHS = [
  "MIGRATION.md",
  "UPGRADING.md",
  "UPGRADE.md",
  "docs/migration.md",
  "docs/MIGRATION.md",
  "docs/upgrading.md",
  "docs/upgrade-guide.md",
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

/** Doc-site path templates that point at a version-specific upgrade guide. */
function versionDocSuffixes(toVersion: string): string[] {
  const v = toVersion.replace(/^v/, "");
  return [
    `/docs/app/guides/upgrading/version-${v}`,
    `/docs/app/building-your-application/upgrading/version-${v}`,
    `/docs/upgrading/version-${v}`,
    `/docs/guides/upgrade-to-${v}`,
    `/docs/migration/${v}`,
  ];
}

/**
 * Trim GitHub release notes (the "## Recent Releases" blob) to entries whose
 * tag major version falls in the requested band. Keeps the leading header and
 * falls back to the raw text when nothing matches, so the section is never
 * blanked.
 */
export function filterReleasesByVersion(raw: string, fromVersion?: string, toVersion?: string): string {
  const fromMajor = parseMajor(fromVersion);
  const toMajor = parseMajor(toVersion);
  if (fromMajor === undefined && toMajor === undefined) return raw;
  // Open the lower bound when only toVersion is supplied — otherwise low===high
  // and only the single exact-major release survives the band filter.
  const low = fromMajor ?? -Infinity;
  const high = toMajor ?? Infinity;
  const parts = raw.split(/\n(?=###\s)/);
  const header = parts.length > 0 && !parts[0]!.startsWith("###") ? parts.shift()! : "";
  // Headerless fragments (release-please style "### Features"/"### Bug Fixes"
  // sub-headers under a versioned release) inherit the preceding versioned
  // fragment's decision instead of being dropped — dropping them stripped the
  // actual changelog content out of every release body.
  let lastInclude = false;
  const kept = parts.filter((entry) => {
    const major = parseMajor(entry.split("\n", 1)[0] ?? "");
    if (major !== undefined) {
      lastInclude = major >= low && major <= high;
      return lastInclude;
    }
    return lastInclude;
  });
  if (kept.length === 0) return raw;
  return (header ? `${header.trimEnd()}\n` : "") + kept.join("\n");
}

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

      // Version-specific upgrade guide — the gold-standard source when the
      // target version is known (e.g. nextjs.org/docs/app/guides/upgrading/version-16).
      // Fetched FIRST and unconditionally so a stale monolithic docs/upgrading.md
      // on GitHub cannot pre-empt the correct page.
      if (toVersion) {
        try {
          const origin = new URL(docsUrl).origin;
          const versioned = versionDocSuffixes(toVersion).map(async (suffix) => {
            const url = `${origin}${suffix}`;
            const content = await fetchAsMarkdownRace(url);
            if (content && content.length > 300) return { source: url, content };
            throw new Error("no content");
          });
          const hit = await Promise.any(versioned);
          sections.push(hit);
        } catch { /* no version-specific page — fall through to other sources */ }
      }

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
          const relevant = (fromVersion || toVersion)
            ? filterReleasesByVersion(releases, fromVersion, toVersion)
            : releases;
          if (relevant.length > 200) {
            sections.push({ source: "GitHub Releases", content: relevant });
          }
        }
      }

      if (sections.length === 0) {
        try {
          const origin = new URL(docsUrl).origin;
          // Race all 7 URL suffixes in parallel — first non-empty result wins.
          // Previously serial w/ 7 timeouts → 35s worst case; now max ~5s.
          const candidates = MIGRATION_URL_SUFFIXES.map(async (suffix) => {
            const url = `${origin}${suffix}`;
            const content = await fetchAsMarkdownRace(url);
            if (content && content.length > 300) return { url, content };
            throw new Error("no content");
          });
          try {
            const hit = await Promise.any(candidates);
            sections.push({ source: hit.url, content: hit.content });
          } catch {
            // All 7 candidates failed — leave sections empty for final-error path
          }
        } catch { /* invalid URL */ }
      }

      // Release notes alone are not a migration guide. Official upgrade guides
      // often live at unguessable URLs (react.dev publishes them as dated blog
      // posts) — find them the way a human would, preferring the library's own
      // docs host, then other authoritative domains.
      if (!sections.some((s) => !s.source.includes("Releases"))) {
        let docsHost = "";
        try {
          docsHost = new URL(docsUrl).hostname;
        } catch { /* keep empty */ }
        const q = [
          displayName,
          "upgrade guide",
          fromVersion ? `from ${fromVersion.replace(/^v/, "")}` : "",
          toVersion ? `to ${toVersion.replace(/^v/, "")}` : "",
        ].filter(Boolean).join(" ");
        const found = await webSearch(q).catch(() => [] as string[]);
        const sameHost = found.filter((u) => {
          try {
            return new URL(u).hostname === docsHost;
          } catch {
            return false;
          }
        });
        const candidates = [...new Set([...sameHost, ...found.filter(isAuthoritativeUrl)])].slice(0, 3);
        for (const url of candidates) {
          const content = await fetchAsMarkdownRace(url).catch(() => null);
          if (content && content.length > 500) {
            const check = checkEvidence(content, "upgrade migration breaking changes");
            if (check.matchRatio > 0) {
              sections.unshift({ source: url, content });
              break;
            }
          }
        }
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

      // Slice to the requested version band BEFORE ranking — this is what stops
      // ancient sections (e.g. Next.js v8-v11) reaching the BM25 pass at all.
      const banded = (fromVersion || toVersion)
        ? sliceVersionBand(combined, fromVersion, toVersion)
        : combined;

      const safe = sanitizeContent(banded);
      const { text, truncated } = extractRelevantContent(safe, topic, tokens);
      const targetVersions = [fromVersion, toVersion].filter((v): v is string => typeof v === "string" && v.length > 0);
      const { score: qualityScore, hints: qualityHints } = computeQualityScore(
        text,
        topic,
        "github-readme",
        targetVersions,
      );

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
    },
  );
}
