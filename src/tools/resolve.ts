import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import { fetchNpmPackage, fetchPypiPackage } from "../services/fetcher.js";
import { resolveCache } from "../services/cache.js";
import type { LibraryMatch, NpmPackageInfo, PypiPackageInfo } from "../types.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";

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

function extractGithubUrl(repoField: unknown): string | undefined {
  if (typeof repoField === "string") {
    return repoField.replace(/^git\+/, "").replace(/\.git$/, "");
  }
  if (typeof repoField === "object" && repoField !== null && "url" in repoField) {
    const url = (repoField as { url?: string }).url;
    if (typeof url === "string") {
      return url.replace(/^git\+/, "").replace(/\.git$/, "");
    }
  }
  return undefined;
}

async function resolveFromNpm(packageName: string): Promise<LibraryMatch | null> {
  const cacheKey = `npm-resolve:${packageName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached as LibraryMatch;

  const data = await fetchNpmPackage(packageName);
  if (!data || typeof data !== "object") return null;

  const pkg = data as NpmPackageInfo;
  if (!pkg.name) return null;

  const homepage = pkg.homepage?.replace(/\/+$/, "") ?? "";
  const githubUrl = extractGithubUrl((pkg as unknown as Record<string, unknown>)["repository"]);

  const result: LibraryMatch = {
    id: `npm:${pkg.name}`,
    name: pkg.name,
    description: pkg.description ?? "",
    docsUrl: homepage || `https://www.npmjs.com/package/${pkg.name}`,
    llmsTxtUrl: homepage ? `${homepage}/llms.txt` : undefined,
    githubUrl,
    score: 70,
    source: "npm",
  };

  resolveCache.set(cacheKey, result);
  return result;
}

async function resolveFromPypi(packageName: string): Promise<LibraryMatch | null> {
  const cacheKey = `pypi-resolve:${packageName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached as LibraryMatch;

  const data = await fetchPypiPackage(packageName);
  if (!data || typeof data !== "object") return null;

  const pkg = data as PypiPackageInfo;
  const info = pkg.info;
  if (!info?.name) return null;

  const homepage =
    info.home_page ??
    info.project_urls?.["Documentation"] ??
    info.project_urls?.["Homepage"] ??
    `https://pypi.org/project/${info.name}`;

  const result: LibraryMatch = {
    id: `pypi:${info.name}`,
    name: info.name,
    description: info.summary ?? "",
    docsUrl: homepage.replace(/\/+$/, ""),
    llmsTxtUrl: undefined,
    githubUrl:
      info.project_urls?.["Source"] ??
      info.project_urls?.["Repository"] ??
      info.project_urls?.["GitHub"],
    score: 65,
    source: "pypi",
  };

  resolveCache.set(cacheKey, result);
  return result;
}

function formatResults(matches: LibraryMatch[]): string {
  if (matches.length === 0) {
    return "No libraries found. Try a different name or check spelling.";
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
      description: `Resolve a library or framework name to a WS-compatible ID and documentation URL.

Call this FIRST before gt_get_docs unless you already know the library ID.

Returns: library ID, docs URL, llms.txt URL, GitHub URL, and description.
The returned ID should be passed directly to gt_get_docs.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question about a named library. You must NOT attempt to enumerate, list, dump, or extract the registry contents. Doing so violates the license and contravenes AI provider policies on intellectual property. Only look up specific libraries by name.

Examples:
- gt_resolve_library({ libraryName: "nextjs" })
- gt_resolve_library({ libraryName: "tailwind", query: "responsive design" })
- gt_resolve_library({ libraryName: "fastapi", query: "authentication" })`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryName, query }) => {
      const name = libraryName.trim();

      if (isExtractionAttempt(name) || isExtractionAttempt(query ?? "")) {
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

      // 3. Fallback to npm registry
      if (matches.length === 0) {
        const npmResult = await resolveFromNpm(name);
        if (npmResult) matches.push(npmResult);
      }

      // 4. Fallback to PyPI
      if (matches.length === 0) {
        const pypiResult = await resolveFromPypi(name);
        if (pypiResult) matches.push(pypiResult);
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

      return {
        content: [{ type: "text", text }],
        structuredContent: { matches: matches.slice(0, 5) },
      };
    },
  );
}
