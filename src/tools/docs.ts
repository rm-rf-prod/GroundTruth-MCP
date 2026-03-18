import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Library ID from ws_resolve_library (e.g. 'vercel/next.js', 'npm:express') or a docs URL",
    ),
  topic: z
    .string()
    .max(500)
    .optional()
    .describe(
      "What you need to learn or do. Examples: 'routing', 'authentication', 'middleware', 'caching', 'streaming'. More specific = more relevant content returned.",
    ),
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
    "ws_get_docs",
    {
      title: "Get Documentation",
      description: `Fetch up-to-date documentation for any library or framework.

Prioritizes llms.txt (machine-readable docs curated for LLMs), then Jina Reader for
JS-rendered pages, then GitHub README as fallback.

Returns the most relevant sections for your topic — not the entire docs.

Steps:
1. Call ws_resolve_library first to get the libraryId
2. Call ws_get_docs with that libraryId and your topic

Examples:
- ws_get_docs({ libraryId: "vercel/next.js", topic: "server actions and mutations" })
- ws_get_docs({ libraryId: "tailwindlabs/tailwindcss", topic: "dark mode" })
- ws_get_docs({ libraryId: "vercel/ai", topic: "streaming with useChat hook" })
- ws_get_docs({ libraryId: "npm:prisma", topic: "migrations" })`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ libraryId, topic = "", tokens }) => {
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
        // Direct URL provided
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

      try {
        fetchResult = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
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
                text: `Error: Could not fetch documentation for "${displayName}".\n\nTried:\n- ${docsUrl}\n${llmsTxtUrl ? `- ${llmsTxtUrl}\n` : ""}${githubUrl ? `- ${githubUrl}\n` : ""}\n\nCheck that the library ID is correct or try ws_resolve_library first.`,
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
        content: [{ type: "text", text: header + text }],
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
