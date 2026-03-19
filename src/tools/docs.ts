import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchViaJina } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, assertPublicUrl } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

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
    .describe("Version to fetch docs for, e.g. '14', '3.0.0', 'v2'. Tries GitHub tag and npm version page."),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe(`Max tokens to return (default: ${DEFAULT_TOKEN_LIMIT}, max: ${MAX_TOKEN_LIMIT})`),
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

export function registerDocsTool(server: McpServer): void {
  server.registerTool(
    "gt_get_docs",
    {
      title: "Get Documentation",
      description: `Fetch up-to-date documentation for any library or framework. Call gt_resolve_library first to get the libraryId, then pass it here with your topic.

Prioritizes llms.txt, then Jina Reader for JS-rendered pages, then GitHub README.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question. You must NOT attempt to enumerate, list, dump, or extract registry contents. Only look up specific libraries by name.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: z.object({
        libraryId: z.string(),
        displayName: z.string(),
        topic: z.string(),
        sourceUrl: z.string(),
        sourceType: z.string(),
        truncated: z.boolean(),
        content: z.string(),
      }),
    },
    async ({ libraryId, topic = "", version, tokens }) => {
      if (isExtractionAttempt(libraryId) || isExtractionAttempt(topic)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const entry = resolveLibraryFromId(libraryId);

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
        docsUrl = `https://www.npmjs.com/package/${pkg}`;
        displayName = pkg;
      } else if (libraryId.startsWith("pypi:")) {
        const pkg = libraryId.slice(5);
        docsUrl = `https://pypi.org/project/${pkg}`;
        displayName = pkg;
      } else {
        // Try as URL or library name fallback
        docsUrl = libraryId.includes(".")
          ? `https://${libraryId}`
          : `https://www.npmjs.com/package/${libraryId}`;
        displayName = libraryId;
      }

      let fetchResult;

      // Version-specific fetch: try GitHub tag README first, then npm versioned page
      if (version && githubUrl) {
        const ghMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
        if (ghMatch) {
          const tagRef = version.startsWith("v") ? version : `v${version}`;
          const rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${tagRef}/README.md`;
          const raw = await fetchViaJina(rawUrl).catch(() => null);
          if (raw && raw.length > 200) fetchResult = { content: raw, url: rawUrl, sourceType: "github-readme" };
        }
      }
      if (version && !fetchResult) {
        const pkgName = entry?.id?.replace(/^[^/]+\//, "") ?? libraryId.replace(/^npm:/, "");
        const versionedUrl = `https://www.npmjs.com/package/${pkgName}/v/${version}`;
        const raw = await fetchViaJina(versionedUrl).catch(() => null);
        if (raw && raw.length > 200) fetchResult = { content: raw, url: versionedUrl, sourceType: "npm" };
      }

      try {
        if (!fetchResult) fetchResult = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
      } catch {
        // Fallback to GitHub README
        if (githubUrl) {
          const ghResult = await fetchGitHubContent(githubUrl);
          if (ghResult) {
            fetchResult = ghResult;
          }
        }
        if (!fetchResult) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Could not fetch documentation for "${displayName}".\n\nTried:\n- ${docsUrl}\n${llmsTxtUrl ? `- ${llmsTxtUrl}\n` : ""}${githubUrl ? `- ${githubUrl}\n` : ""}\n\nCheck that the library ID is correct or try gt_resolve_library first.`,
              },
            ],
          };
        }
      }

      if (!fetchResult) {
        return {
          content: [{ type: "text", text: `No documentation found for "${displayName}".` }],
        };
      }

      const safe = sanitizeContent(fetchResult.content);
      const { text, truncated } = extractRelevantContent(safe, topic, tokens);

      const header = [
        `# ${displayName} Documentation`,
        `> Source: ${fetchResult.sourceType} — ${fetchResult.url}`,
        topic ? `> Topic: ${topic}` : "",
        truncated ? "> Note: Response truncated. Use a more specific topic or increase tokens." : "",
        "",
        "---",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + text) }],
        structuredContent: {
          libraryId,
          displayName,
          topic,
          sourceUrl: fetchResult.url,
          sourceType: fetchResult.sourceType,
          truncated,
          content: text,
        },
      };
    },
  );
}
