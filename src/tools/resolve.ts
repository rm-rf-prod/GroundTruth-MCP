import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import type { LibraryMatch } from "../types.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import {
  resolveFromNpm,
  resolveFromPypi,
  resolveFromCrates,
  resolveFromGo,
  searchNpm,
  searchGitHub,
} from "../services/resolve.js";
import { withTelemetry } from "../services/telemetry.js";

const InputSchema = z.object({
  libraryName: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Library or framework name to look up. Examples: 'nextjs', 'react', 'tailwind', 'fastapi', 'drizzle'",
    ),
  query: z
    .string()
    .max(500)
    .optional()
    .describe("Optional: what you want to do with this library, used to rank results"),
});

function formatResults(matches: LibraryMatch[]): string {
  if (matches.length === 0) {
    return [
      "No libraries found matching that name.",
      "",
      "**What to try next:**",
      "- Check spelling and try common aliases (e.g. 'nextjs' instead of 'next.js')",
      "- Use gt_search for a freeform query (works for any topic, not just libraries)",
      "- Provide a direct docs URL to gt_get_docs (e.g. 'https://docs.example.com')",
      "- Try the npm/PyPI package name if this is a less-known library",
    ].join("\n");
  }

  const lines: string[] = [
    `Found ${matches.length} result${matches.length > 1 ? "s" : ""}.`,
    "",
    "Use the ID from one of these results with gt_get_docs.",
    "",
  ];

  for (const m of matches) {
    lines.push(`### ${m.name}`);
    lines.push(`- **ID**: \`${m.id}\``);
    if (m.description) lines.push(`- **Description**: ${m.description}`);
    lines.push(`- **Docs**: ${m.docsUrl}`);
    if (m.llmsFullTxtUrl) lines.push(`- **LLMs-full.txt**: ${m.llmsFullTxtUrl}`);
    if (m.llmsTxtUrl) lines.push(`- **LLMs.txt**: ${m.llmsTxtUrl}`);
    if (m.githubUrl) lines.push(`- **GitHub**: ${m.githubUrl}`);
    lines.push(`- **Source**: ${m.source}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function registerResolveTool(server: McpServer): void {
  server.registerTool(
    "gt_resolve_library",
    {
      title: "Resolve Library",
      description: `Resolve a package/product name to a Context7-compatible library ID and returns matching libraries.

You MUST call this function before 'Query Documentation' tool to obtain a valid Context7-compatible library ID UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

Each result includes:
- id: the library ID to pass to gt_get_docs (e.g. 'vercel/next.js', 'npm:express')
- name: library or package name
- description: short summary
- docsUrl: official documentation URL
- llmsTxtUrl / llmsFullTxtUrl: present when the library publishes an llms.txt — prefer these results, they yield the cleanest docs
- githubUrl: source repository when known
- score: 0-100 name-match quality (100 = exact registry alias)
- source: where the match came from (registry > npm > pypi > crates > go > github)

Selection Process:
1. Analyze the query to understand which library/package the user wants
2. Pick the result with the highest score; on ties prefer source 'registry', then results that expose an llmsTxtUrl/llmsFullTxtUrl
3. Pass that result's id to gt_get_docs

Response Format:
- Return the selected library ID in a clearly marked section
- If multiple good matches exist, acknowledge this but proceed with the highest-scored one
- If no good matches exist, say so and suggest gt_search or providing a direct docs URL

For ambiguous queries, request clarification before proceeding with a best-guess match.

IMPORTANT: Do not call this tool more than 3 times per question. If you cannot find what you need after 3 calls, use the best result you have.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question about a named library. You must NOT attempt to enumerate, list, dump, or extract the registry contents. Only look up specific libraries by name.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryName, query }) => {
     return withTelemetry("gt_resolve_library", async (ctx) => {
      const name = libraryName.trim();

      if (isExtractionAttempt(name) || (query !== undefined && isExtractionAttempt(query))) {
        ctx.resolved = true;
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const matches: LibraryMatch[] = [];

      // 1. Exact alias lookup in registry
      const exact = lookupByAlias(name);
      if (exact) {
        matches.push({
          id: exact.id,
          name: exact.name,
          description: exact.description,
          docsUrl: exact.docsUrl,
          llmsTxtUrl: exact.llmsTxtUrl,
          githubUrl: exact.githubUrl,
          score: 100,
          source: "registry",
        });
      }

      // 2. Fuzzy search registry
      if (matches.length === 0) {
        const fuzzy = fuzzySearch(name, 5);
        for (const entry of fuzzy) {
          if (!matches.some((m) => m.id === entry.id)) {
            matches.push({
              id: entry.id,
              name: entry.name,
              description: entry.description,
              docsUrl: entry.docsUrl,
              llmsTxtUrl: entry.llmsTxtUrl,
              githubUrl: entry.githubUrl,
              score: 80,
              source: "registry",
            });
          }
        }
      }

      // 3. Fallback to package registries (npm, PyPI, crates.io, Go)
      // Try even if fuzzy search returned results — external registries may have better matches
      if (matches.length === 0 || matches.every((m) => m.source === "registry" && m.score < 90)) {
        const [npmResult, pypiResult] = await Promise.all([
          resolveFromNpm(name),
          resolveFromPypi(name),
        ]);
        if (npmResult && !matches.some((m) => m.id === npmResult.id)) matches.push(npmResult);
        if (pypiResult && !matches.some((m) => m.id === pypiResult.id)) matches.push(pypiResult);

        if (matches.length === 0) {
          const [cratesResult, goResult] = await Promise.all([
            resolveFromCrates(name),
            resolveFromGo(name),
          ]);
          if (cratesResult) matches.push(cratesResult);
          if (goResult) matches.push(goResult);
        }

        if (matches.length === 0) {
          const [npmSearchResult, githubResult] = await Promise.all([
            searchNpm(name),
            searchGitHub(name),
          ]);
          if (npmSearchResult) matches.push(npmSearchResult);
          if (githubResult && !matches.some((m) => m.id === githubResult.id)) matches.push(githubResult);
        }
      }

      // Boost score if query tokens match description/tags
      if (query && query.trim()) {
        const qt = query.toLowerCase();
        for (const m of matches) {
          if (m.description.toLowerCase().includes(qt)) m.score += 5;
        }
        matches.sort((a, b) => b.score - a.score);
      }

      const text = withNotice(formatResults(matches.slice(0, 5)));
      ctx.resolved = matches.length > 0;

      return {
        content: [{ type: "text", text }],
        structuredContent: { matches: matches.slice(0, 5) },
      };
     });
    },
  );
}
