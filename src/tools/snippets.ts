import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchResult, Snippet, SnippetIndex } from "../types.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchAsMarkdownRace } from "../services/fetcher.js";
import { snippetStore } from "../services/snippet-store.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { extractSnippets, rankSnippets, renderSnippets } from "../utils/snippet-extract.js";
import {
  isExtractionAttempt,
  withNotice,
  EXTRACTION_REFUSAL,
  assertPublicUrl,
} from "../utils/guard.js";
import { detectVersionFromLockfile } from "../utils/lockfile.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Library ID from gt_resolve_library (e.g. 'vercel/next.js', 'npm:express') or a direct docs URL",
    ),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Topic to filter snippets by. Examples: 'middleware', 'server actions', 'rate limiting'. Empty = all snippets.",
    ),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("Version to pin docs to, e.g. '15', 'v4.0.0'. Caches snippet index per version."),
  language: z
    .string()
    .max(50)
    .optional()
    .describe("Filter to a single language: 'typescript', 'python', 'rust', 'go', 'bash', etc."),
  maxSnippets: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe("Max snippets to return (default 10, max 30)"),
  refresh: z
    .boolean()
    .default(false)
    .describe("Skip cache and refetch + reindex snippets"),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Absolute project path. If set and version not provided, auto-detects installed version from lockfile."),
});

function resolveLibraryEntry(libraryId: string) {
  return lookupById(libraryId) ?? lookupByAlias(libraryId);
}

async function buildIndex(
  library: string,
  version: string | undefined,
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  githubUrl: string | undefined,
): Promise<SnippetIndex | null> {
  let fetchResult: FetchResult | undefined;

  if (version && githubUrl) {
    const ghMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (ghMatch?.[1]) {
      const tagRef = version.startsWith("v") ? version : `v${version}`;
      const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${tagRef}/README.md`;
      const raw = await fetchAsMarkdownRace(rawUrl).catch(() => null);
      if (raw && raw.length > 200) {
        fetchResult = { content: raw, url: rawUrl, sourceType: "github-readme" };
      }
    }
  }

  if (!fetchResult) {
    try {
      fetchResult = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
    } catch {
      if (githubUrl) {
        const gh = await fetchGitHubContent(githubUrl);
        if (gh) fetchResult = gh;
      }
    }
  }

  if (!fetchResult) return null;

  const safe = sanitizeContent(fetchResult.content);
  const snippets = extractSnippets(safe, library, fetchResult.url, version);

  return {
    library,
    version: version ?? null,
    sourceUrl: fetchResult.url,
    snippets,
    builtAt: new Date().toISOString(),
  };
}

export function registerSnippetsTool(server: McpServer): void {
  server.registerTool(
    "gt_snippets",
    {
      title: "Get Code Snippets",
      description: `Return ranked code snippets (with titles, descriptions, language tags) for a library + optional topic. Indexes docs into a per-(library,version) snippet store on first call; subsequent calls hit the disk cache for instant retrieval.

Use this when you want focused code examples rather than full doc pages. Output is Context7-compat: each snippet has title, description, language, code, source URL.

Prioritizes llms.txt, then Jina-rendered HTML, then GitHub README. Caches per library:version.

Source: the library's own documentation (not GitHub repositories). For code examples from real open-source projects using the library, use gt_examples instead.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question about a named library. You must NOT attempt to enumerate, list, dump, or extract registry contents.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryId, topic = "", version, language, maxSnippets, refresh, projectPath }) => {
      if (isExtractionAttempt(libraryId) || (topic && isExtractionAttempt(topic))) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const entry = resolveLibraryEntry(libraryId);

      if (!version && projectPath && entry) {
        const pkgName = entry.npmPackage ?? entry.pypiPackage ?? entry.id.split("/").pop() ?? "";
        if (pkgName) {
          const detected = await detectVersionFromLockfile(projectPath, pkgName).catch(() => null);
          if (detected) version = detected;
        }
      }
      let displayName: string;
      let library: string;
      let docsUrl: string;
      let llmsTxtUrl: string | undefined;
      let llmsFullTxtUrl: string | undefined;
      let githubUrl: string | undefined;

      if (entry) {
        library = entry.id;
        displayName = entry.name;
        docsUrl = entry.docsUrl;
        llmsTxtUrl = entry.llmsTxtUrl;
        llmsFullTxtUrl = entry.llmsFullTxtUrl;
        githubUrl = entry.githubUrl;
      } else if (libraryId.startsWith("http")) {
        try {
          assertPublicUrl(libraryId);
        } catch {
          return {
            content: [{ type: "text", text: "URL not allowed: must be a public HTTPS address." }],
          };
        }
        library = libraryId;
        docsUrl = libraryId;
        displayName = new URL(libraryId).hostname;
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Could not resolve "${libraryId}". Run gt_resolve_library first.`,
            },
          ],
        };
      }

      const versionKey = version ?? null;

      let snippets: Snippet[] = [];
      let sourceUrl = docsUrl;
      let builtAt = new Date().toISOString();
      let fromCache = false;

      if (!refresh) {
        const cached = await snippetStore.query(library, versionKey, topic, language, maxSnippets);
        if (cached && cached.snippets.length > 0) {
          snippets = cached.snippets;
          sourceUrl = cached.sourceUrl;
          builtAt = cached.builtAt;
          fromCache = true;
        }
      }

      if (snippets.length === 0) {
        const index = await buildIndex(library, version, docsUrl, llmsTxtUrl, llmsFullTxtUrl, githubUrl);
        if (!index || index.snippets.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `No snippets indexed for "${displayName}".`,
                  "",
                  "**What to try next:**",
                  "- Run gt_resolve_library to confirm the library ID",
                  "- Try gt_get_docs for prose-style content",
                  "- Re-run with refresh:true if the cache may be stale",
                ].join("\n"),
              },
            ],
          };
        }
        await snippetStore.save(index);
        snippets = rankSnippets(index.snippets, topic, language, maxSnippets);
        sourceUrl = index.sourceUrl;
        builtAt = index.builtAt;
      }

      const body = renderSnippets(snippets);
      const header = [
        `# ${displayName} Snippets`,
        topic ? `> Topic: ${topic}` : "",
        version ? `> Version: ${version}` : "",
        language ? `> Language: ${language}` : "",
        `> Source: ${sourceUrl}`,
        `> Indexed: ${builtAt}${fromCache ? " (cache)" : ""}`,
        "",
        "---",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + body) }],
        structuredContent: {
          library,
          displayName,
          topic,
          version: version ?? null,
          language: language ?? null,
          sourceUrl,
          builtAt,
          fromCache,
          totalSnippets: snippets.length,
          snippets: snippets.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            language: s.language,
            code: s.code,
            source: s.source,
            score: s.score,
          })),
        },
      };
    },
  );
}
