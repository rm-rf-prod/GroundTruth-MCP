import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchResult } from "../types.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchAsMarkdownRace } from "../services/fetcher.js";
import { probeLlmsTxt } from "../services/resolve.js";
import { deepFetchForTopic, splitTopics } from "../services/deep-fetch.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock, buildHonestMiss, extractHeadingOutline } from "../utils/evidence.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, assertPublicUrl } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { computeQualityScore } from "../utils/quality.js";
import { detectVersionFromLockfile } from "../utils/lockfile.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";
import { withTelemetry } from "../services/telemetry.js";

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

function resolveLibraryFromId(libraryId: string) {
  // Direct registry ID
  const direct = lookupById(libraryId);
  if (direct) return direct;

  // Alias lookup
  const alias = lookupByAlias(libraryId);
  if (alias) return alias;

  return null;
}

/**
 * Validate an npm / PyPI package name for safe URL construction.
 * Allows an optional @scope/ prefix and the standard name charset; rejects path
 * traversal (.., //), protocol-relative input, and over-long names. Preserves
 * valid scoped packages that encodeURIComponent would otherwise corrupt.
 */
function isValidPackageName(pkg: string): boolean {
  if (!pkg || pkg.length > 214) return false;
  if (pkg.includes("..") || pkg.includes("//")) return false;
  return /^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/i.test(pkg);
}

export function registerDocsTool(server: McpServer): void {
  server.registerTool(
    "gt_get_docs",
    {
      title: "Get Documentation",
      description: `Fetch up-to-date documentation for any library or framework. Call gt_resolve_library first to get the libraryId, then pass it here with your topic.

Prioritizes llms.txt, then Jina Reader for JS-rendered pages, then GitHub README.

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
      if (isExtractionAttempt(libraryId) || (topic && isExtractionAttempt(topic))) {
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

      let docsUrl: string;
      let llmsTxtUrl: string | undefined;
      let llmsFullTxtUrl: string | undefined;
      let githubUrl: string | undefined;
      let displayName: string;

      if (entry) {
        docsUrl = entry.docsUrl;
        llmsTxtUrl = entry.llmsTxtUrl;
        llmsFullTxtUrl = entry.llmsFullTxtUrl;
        githubUrl = entry.githubUrl;
        displayName = entry.name;

        // Lazy llms.txt discovery for registry entries missing the URL
        if (!llmsTxtUrl && !llmsFullTxtUrl) {
          const probed = await probeLlmsTxt(docsUrl);
          if (probed.llmsTxtUrl) llmsTxtUrl = probed.llmsTxtUrl;
          if (probed.llmsFullTxtUrl) llmsFullTxtUrl = probed.llmsFullTxtUrl;
        }
      } else if (libraryId.startsWith("http")) {
        // Direct URL provided — validate it is not an internal/private target
        try {
          assertPublicUrl(libraryId);
        } catch {
          return { content: [{ type: "text", text: `URL not allowed: must be a public HTTPS address.` }] };
        }
        docsUrl = libraryId;
        displayName = new URL(libraryId).hostname;
      } else if (libraryId.startsWith("npm:")) {
        // npm package — point to npmjs.com
        const pkg = libraryId.slice(4);
        if (!isValidPackageName(pkg)) {
          return { content: [{ type: "text", text: `Invalid npm package name: "${pkg}".` }] };
        }
        docsUrl = `https://www.npmjs.com/package/${pkg}`;
        displayName = pkg;
      } else if (libraryId.startsWith("pypi:")) {
        const pkg = libraryId.slice(5);
        if (!isValidPackageName(pkg)) {
          return { content: [{ type: "text", text: `Invalid PyPI package name: "${pkg}".` }] };
        }
        docsUrl = `https://pypi.org/project/${pkg}`;
        displayName = pkg;
      } else {
        // Try as URL or library name fallback
        if (libraryId.includes(".")) {
          const candidateUrl = `https://${libraryId}`;
          try {
            // Hard SSRF gate — refuse any libraryId that resolves to a private/internal target
            assertPublicUrl(candidateUrl);
          } catch {
            return {
              content: [{
                type: "text",
                text: `URL not allowed: "${libraryId}" resolves to a private/internal target. Must be a public host.`,
              }],
            };
          }
          docsUrl = candidateUrl;
        } else {
          if (!isValidPackageName(libraryId)) {
            return { content: [{ type: "text", text: `Invalid library name: "${libraryId}".` }] };
          }
          docsUrl = `https://www.npmjs.com/package/${libraryId}`;
        }
        displayName = libraryId;
      }

      let fetchResult: FetchResult | undefined;

      // Version-specific fetch: try GitHub tag README first, then npm versioned page
      if (version && githubUrl) {
        const ghMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
        if (ghMatch) {
          const tagRef = version.startsWith("v") ? version : `v${version}`;
          const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${tagRef}/README.md`;
          const raw = await fetchAsMarkdownRace(rawUrl).catch(() => null);
          if (raw && raw.length > 200) fetchResult = { content: raw, url: rawUrl, sourceType: "github-readme" };
        }
      }
      if (version && !fetchResult) {
        const pkgName = entry?.id?.replace(/^[^/]+\//, "") ?? libraryId.replace(/^npm:/, "");
        if (isValidPackageName(pkgName) && /^[\w.-]+$/.test(version)) {
          const versionedUrl = `https://www.npmjs.com/package/${pkgName}/v/${version}`;
          const raw = await fetchAsMarkdownRace(versionedUrl).catch(() => null);
          if (raw && raw.length > 200) fetchResult = { content: raw, url: versionedUrl, sourceType: "npm" };
        }
      }

      try {
        if (!fetchResult) fetchResult = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl, topic || undefined);
      } catch {
        // Fallback to GitHub README
        if (githubUrl) {
          // If a version was requested, prefer the version-tagged README so the
          // fallback does not silently serve HEAD content for a pinned request.
          if (version && !fetchResult) {
            const ghMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
            if (ghMatch) {
              const tagRef = version.startsWith("v") ? version : `v${version}`;
              const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${tagRef}/README.md`;
              const raw = await fetchAsMarkdownRace(rawUrl).catch(() => null);
              if (raw && raw.length > 200) fetchResult = { content: raw, url: rawUrl, sourceType: "github-readme" };
            }
          }
          if (!fetchResult) {
            const ghResult = await fetchGitHubContent(githubUrl);
            if (ghResult) {
              fetchResult = ghResult;
            }
          }
        }
        if (!fetchResult) {
          const tried: string[] = [docsUrl];
          if (llmsTxtUrl) tried.push(llmsTxtUrl);
          if (llmsFullTxtUrl) tried.push(llmsFullTxtUrl);
          if (githubUrl) tried.push(githubUrl);

          const suggestions: string[] = [];
          if (!entry) suggestions.push("- Run gt_resolve_library to verify the library ID is correct");
          suggestions.push("- Try gt_search with your question as a freeform query");
          if (!githubUrl) suggestions.push("- Provide a direct docs URL as the libraryId (e.g. 'https://docs.example.com')");
          if (topic) suggestions.push("- Try without a topic filter to get the main docs page");

          return {
            content: [
              {
                type: "text",
                text: [
                  `Could not fetch documentation for "${displayName}".`,
                  "",
                  "**Sources attempted:**",
                  ...tried.map((u) => `- ${u}`),
                  "",
                  "**What to try next:**",
                  ...suggestions,
                ].join("\n"),
              },
            ],
          };
        }
      }

      if (!fetchResult) {
        return {
          content: [{
            type: "text",
            text: [
              `No documentation found for "${displayName}".`,
              "",
              "**What to try next:**",
              "- Run gt_resolve_library to check if the library exists under a different name",
              "- Try gt_search with a freeform query about what you need",
              "- Provide a direct docs URL as the libraryId",
            ].join("\n"),
          }],
        };
      }

      if (topic) {
        const subtopics = splitTopics(topic);
        if (subtopics.length > 1) {
          const baseCopy: FetchResult = {
            content: fetchResult.content,
            url: fetchResult.url,
            sourceType: fetchResult.sourceType,
          };
          const results = await Promise.all(
            subtopics.map((st) => deepFetchForTopic(
              baseCopy,
              st,
              docsUrl,
              entry?.urlPatterns,
            )),
          );
          const combined = results
            .filter((r) => r.content.length > 200)
            .map((r) => `## ${r.url}\n\n${r.content}`)
            .join("\n\n---\n\n");
          if (combined.length > 300) {
            fetchResult = {
              content: combined,
              url: results[0]?.url ?? docsUrl,
              sourceType: "deep-fetch",
            };
          }
        } else {
          fetchResult = await deepFetchForTopic(fetchResult, topic, docsUrl, entry?.urlPatterns);
        }
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

      if (topic && !evidence.ok) {
        const deeper = await deepFetchForTopic(fetchResult, topic, docsUrl, entry?.urlPatterns, undefined, true);
        escalated = true;
        if (deeper.url !== fetchResult.url) {
          sourcesTried.push({ url: deeper.url, sourceType: deeper.sourceType });
        }
        const deeperSafe = sanitizeContent(deeper.content);
        const reExtract = extractRelevantContent(deeperSafe, topic, tokens);
        const reCheck = checkEvidence(reExtract.text, topic);
        if (reCheck.ok || reCheck.occurrences > evidence.occurrences) {
          fetchResult = deeper;
          safe = deeperSafe;
          text = reExtract.text;
          truncated = reExtract.truncated;
          evidence = reCheck;
        }
      }

      const { score: qualityScore, hints: qualityHints } = computeQualityScore(text, topic, fetchResult.sourceType);
      const evidenceSummary = {
        ok: evidence.ok,
        matchRatio: evidence.matchRatio,
        occurrences: evidence.occurrences,
        matchedTokens: evidence.matchedTokens,
        missingTokens: evidence.missingTokens,
        escalated,
        verdict: !topic ? "untargeted" : evidence.ok ? "strong" : evidence.matchRatio > 0 ? "weak" : "miss",
      };

      // Hard miss: the topic never appears in anything fetched. Returning the
      // doc's intro here would be exactly the "generic answer" failure mode.
      if (topic && evidence.matchRatio === 0) {
        const missText = buildHonestMiss({
          subject: displayName,
          topic,
          tried: sourcesTried.map((s) => s.url),
          outline: extractHeadingOutline(safe),
        });
        ctx.resolved = false;
        return {
          content: [{ type: "text", text: withNotice(missText) }],
          structuredContent: {
            libraryId,
            displayName,
            topic,
            version: version ?? null,
            sourceUrl: fetchResult.url,
            sourceType: fetchResult.sourceType,
            truncated: false,
            qualityScore: 0,
            qualityHints: ["No topic-specific evidence found in any fetched source"],
            evidence: evidenceSummary,
            sourcesTried: sourcesTried.map((s) => s.url),
            content: missText,
          },
        };
      }

      const header = [
        `# ${displayName} Documentation`,
        `> Source: ${fetchResult.sourceType} — ${fetchResult.url}`,
        topic ? `> Topic: ${topic}` : "",
        truncated ? "> Note: Response truncated. Use a more specific topic or increase tokens." : "",
        topic && !evidence.ok ? `> Evidence: Weak — topic terms appear only sparsely (${evidence.occurrences} occurrence${evidence.occurrences === 1 ? "" : "s"}). Verify against the source before relying on this.` : "",
        qualityScore < 0.4 ? `> Quality: Low — ${qualityHints.join("; ") || "try a more specific topic or different library ID."}` : "",
        "",
        "---",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      const evidenceBlock = buildEvidenceBlock({
        sources: sourcesTried,
        topic,
        ...(topic ? { check: evidence } : {}),
        escalated,
      });

      ctx.resolved = text.length > 200;
      return {
        content: [{ type: "text", text: withNotice(header + text + evidenceBlock) }],
        structuredContent: {
          libraryId,
          displayName,
          topic,
          version: version ?? null,
          sourceUrl: fetchResult.url,
          sourceType: fetchResult.sourceType,
          contentHash: fetchResult.contentHash,
          fetchedAt: fetchResult.fetchedAt,
          truncated,
          qualityScore,
          qualityHints,
          evidence: evidenceSummary,
          content: text,
        },
      };
     });
    },
  );
}
