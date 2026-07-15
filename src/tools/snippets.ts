import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FetchResult, Snippet, SnippetIndex } from "../types.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchAsMarkdownRace, isIndexContent, rankIndexLinks, fetchSitemapUrls } from "../services/fetcher.js";
import { extractInternalLinks, rankLinksForTopic, fetchMultiplePages } from "../services/deep-fetch.js";
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
import { isValidPackageName } from "./docs.js";

/** Snippets that answer the topic; all snippets when no topic given. */
function topicMatches(snippets: Snippet[], topic: string): number {
  return topic.trim().length > 0 ? rankSnippets(snippets, topic, undefined, 3).length : snippets.length;
}

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

export async function buildIndex(
  library: string,
  version: string | undefined,
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  githubUrl: string | undefined,
  topic = "",
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

  let snippets = extractSnippets(sanitizeContent(fetchResult.content), library, fetchResult.url, version);
  let sourceUrl = fetchResult.url;

  // Reliability fallback: landing-page-only docs (e.g. expressjs.com) carry no
  // fenced code, so the index comes back empty. The GitHub README almost always
  // has usage examples — retry there before giving up, unless it was already the
  // source. This is why gt_snippets("expressjs/express") returned "No snippets".
  if (snippets.length === 0 && githubUrl && fetchResult.sourceType !== "github-readme") {
    const gh = await fetchGitHubContent(githubUrl).catch(() => null);
    if (gh?.content) {
      const ghSnippets = extractSnippets(sanitizeContent(gh.content), library, gh.url, version);
      if (ghSnippets.length > 0) {
        snippets = ghSnippets;
        sourceUrl = gh.url;
      }
    }
  }

  // Framework docs are often a link index (llms.txt/TOC) with zero fenced
  // code — the snippets live one level down. Traverse the most topic-relevant
  // child pages and index those too. This is why gt_snippets("vercel/next.js")
  // used to return "No snippets indexed". Topic-aware: a landing page full of
  // install commands must not satisfy a "shared value" query.
  if (topicMatches(snippets, topic) < 3) {
    const seedTopic = topic.trim().length > 0 ? topic : "example usage getting started";
    const fromIndex = isIndexContent(fetchResult.content)
      ? rankIndexLinks(fetchResult.content, seedTopic, fetchResult.url || docsUrl)
      : [];
    const fromLinks = rankLinksForTopic(
      extractInternalLinks(fetchResult.content, docsUrl),
      seedTopic,
    ).map((l) => l.url);
    const candidates = [...new Set([...fromIndex, ...fromLinks])].slice(0, 4);
    if (candidates.length > 0) {
      const pages = await fetchMultiplePages(candidates, 4);
      const seen = new Set(snippets.map((s) => s.id));
      const collect = (content: string, url: string): void => {
        for (const s of extractSnippets(sanitizeContent(content), library, url, version)) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            snippets.push(s);
          }
        }
      };
      for (const page of pages) collect(page.content, page.url);

      // Hop 2: topic landing pages (e.g. supabase guides/auth.md) are often
      // code-free overviews linking to the concrete sub-guides.
      if (topicMatches(snippets, topic) < 3 && pages.length > 0) {
        const secondary = [
          ...new Set(
            pages.flatMap((p) =>
              rankLinksForTopic(extractInternalLinks(p.content, p.url), seedTopic)
                .slice(0, 2)
                .map((l) => l.url),
            ),
          ),
        ].filter((u) => !candidates.includes(u));
        for (const page of await fetchMultiplePages(secondary.slice(0, 3), 3)) {
          collect(page.content, page.url);
        }
      }
    }

    // Hop 3: JS-rendered sidebars (Docusaurus etc.) hide most doc links from
    // converted pages — the sitemap lists every page.
    if (topicMatches(snippets, topic) < 3) {
      const sitemapUrls = await fetchSitemapUrls(docsUrl);
      const ranked = rankLinksForTopic(
        sitemapUrls.map((url) => ({ url, text: url })),
        seedTopic,
      ).slice(0, 3);
      if (ranked.length > 0) {
        const seen = new Set(snippets.map((s) => s.id));
        for (const page of await fetchMultiplePages(ranked.map((l) => l.url), 3)) {
          for (const s of extractSnippets(sanitizeContent(page.content), library, page.url, version)) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              snippets.push(s);
            }
          }
        }
      }
    }
  }

  return {
    library,
    version: version ?? null,
    sourceUrl,
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

Prioritizes llms.txt, then Jina-rendered HTML, then GitHub README. Caches per library:version. An explicit version overrides projectPath lockfile auto-detection. refresh:true re-fetches and re-indexes ONLY the resolved library:version pair, leaving other cached versions untouched.

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
      // Guard only the resolution identifier (see docs.ts) — topic is a
      // content filter, not a registry key.
      if (isExtractionAttempt(libraryId)) {
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
      } else if (libraryId.startsWith("npm:")) {
        // npm:/pypi: IDs are documented in this tool's own schema — resolve
        // them the same way gt_get_docs does instead of refusing.
        const pkg = libraryId.slice(4);
        if (!isValidPackageName(pkg)) {
          return { content: [{ type: "text", text: `Invalid npm package name: "${pkg}".` }] };
        }
        library = libraryId;
        docsUrl = `https://www.npmjs.com/package/${pkg}`;
        displayName = pkg;
      } else if (libraryId.startsWith("pypi:")) {
        const pkg = libraryId.slice(5);
        if (!isValidPackageName(pkg)) {
          return { content: [{ type: "text", text: `Invalid PyPI package name: "${pkg}".` }] };
        }
        library = libraryId;
        docsUrl = `https://pypi.org/project/${pkg}`;
        displayName = pkg;
      } else if (libraryId.startsWith("http://") || libraryId.startsWith("https://")) {
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
        const index = await buildIndex(library, version, docsUrl, llmsTxtUrl, llmsFullTxtUrl, githubUrl, topic);

        // Merge with whatever the store already holds for this library:version.
        // Topic-directed traversal indexes different pages per topic — the
        // union accumulates coverage instead of each rebuild wiping the last.
        if (index) {
          // refresh:true is documented as a clean rebuild — merging with the
          // old disk index would carry deleted upstream snippets forever.
          const existing = refresh ? null : await snippetStore.load(library, versionKey);
          if (existing && existing.snippets.length > 0) {
            const byId = new Map(existing.snippets.map((s) => [s.id, s]));
            for (const s of index.snippets) byId.set(s.id, s);
            index.snippets = [...byId.values()].slice(-500);
          }
        }

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
                  "- Try gt_examples for real-world usage examples from GitHub repositories",
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

        // Topic matched nothing in a non-empty index: say so explicitly and
        // show what IS available instead of returning an empty shell.
        if (snippets.length === 0) {
          const available = index.snippets
            .slice(0, 10)
            .map((s) => `- ${s.title}${s.language ? ` (${s.language})` : ""}`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: [
                  `# ${displayName} — no snippets match "${topic}"${language ? ` in ${language}` : ""}`,
                  "",
                  `The snippet index for ${displayName} (${index.snippets.length} snippets from ${index.sourceUrl}) contains no code matching that topic. Closest available snippets:`,
                  "",
                  available,
                  "",
                  "**What to try next:**",
                  "- Re-run with one of the topics listed above, or without a topic to see everything",
                  `- Try gt_get_docs with topic "${topic}" for prose documentation`,
                  "- Try gt_examples for real-world GitHub usage of this pattern",
                ].join("\n"),
              },
            ],
            structuredContent: {
              library,
              displayName,
              topic,
              version: version ?? null,
              language: language ?? null,
              sourceUrl: index.sourceUrl,
              totalSnippets: 0,
              indexedSnippets: index.snippets.length,
              snippets: [],
            },
          };
        }
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
