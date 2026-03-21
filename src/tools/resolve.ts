import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import { fetchNpmPackage, fetchPypiPackage, fetchWithTimeout, fetchViaJina } from "../services/fetcher.js";
import { resolveCache } from "../services/cache.js";
import type { LibraryMatch, NpmPackageInfo, PypiPackageInfo } from "../types.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, assertPublicUrl } from "../utils/guard.js";

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

interface CratesApiResponse {
  crate: {
    name: string;
    description?: string;
    homepage?: string;
    repository?: string;
    documentation?: string;
    max_stable_version?: string;
  };
}

async function probeLlmsTxt(homepage: string): Promise<{ llmsTxtUrl?: string; llmsFullTxtUrl?: string }> {
  try { assertPublicUrl(homepage); } catch { return {}; }
  const result: { llmsTxtUrl?: string; llmsFullTxtUrl?: string } = {};
  try {
    const fullRes = await fetchWithTimeout(`${homepage}/llms-full.txt`, 5000);
    if (fullRes.ok) result.llmsFullTxtUrl = `${homepage}/llms-full.txt`;
  } catch { /* timeout or network error */ }
  try {
    const res = await fetchWithTimeout(`${homepage}/llms.txt`, 5000);
    if (res.ok) result.llmsTxtUrl = `${homepage}/llms.txt`;
  } catch { /* timeout or network error */ }
  return result;
}

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
  if (cached) return cached;

  const data = await fetchNpmPackage(packageName);
  if (!data || typeof data !== "object") return null;

  const pkg = data as NpmPackageInfo;
  if (!pkg.name) return null;

  const homepage = pkg.homepage?.replace(/\/+$/, "") ?? "";
  const githubUrl = extractGithubUrl(pkg.repository);

  const llmsProbe = homepage ? await probeLlmsTxt(homepage) : {};

  const result: LibraryMatch = {
    id: `npm:${pkg.name}`,
    name: pkg.name,
    description: pkg.description ?? "",
    docsUrl: homepage || `https://www.npmjs.com/package/${pkg.name}`,
    llmsTxtUrl: llmsProbe.llmsTxtUrl,
    ...(llmsProbe.llmsFullTxtUrl !== undefined && { llmsFullTxtUrl: llmsProbe.llmsFullTxtUrl }),
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
  if (cached) return cached;

  const data = await fetchPypiPackage(packageName);
  if (!data || typeof data !== "object") return null;

  const pkg = data as PypiPackageInfo;
  const info = pkg.info;
  if (!info?.name) return null;

  const homepageRaw =
    info.home_page ??
    info.project_urls?.["Documentation"] ??
    info.project_urls?.["Homepage"] ??
    `https://pypi.org/project/${info.name}`;
  const homepage = homepageRaw.replace(/\/+$/, "");

  const llmsProbe = await probeLlmsTxt(homepage);

  const result: LibraryMatch = {
    id: `pypi:${info.name}`,
    name: info.name,
    description: info.summary ?? "",
    docsUrl: homepage,
    llmsTxtUrl: llmsProbe.llmsTxtUrl,
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

async function resolveFromCrates(packageName: string): Promise<LibraryMatch | null> {
  const cacheKey = `crates-resolve:${packageName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(
      `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`,
      8000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as CratesApiResponse;
    if (!data?.crate?.name) return null;

    const { crate } = data;
    const homepage = (crate.documentation ?? crate.homepage ?? crate.repository ?? "").replace(/\/+$/, "");
    const docsUrl = homepage || `https://crates.io/crates/${crate.name}`;

    const llmsProbe = homepage ? await probeLlmsTxt(homepage) : {};

    const result: LibraryMatch = {
      id: `crates:${crate.name}`,
      name: crate.name,
      description: crate.description ?? "",
      docsUrl,
      llmsTxtUrl: llmsProbe.llmsTxtUrl,
      ...(llmsProbe.llmsFullTxtUrl !== undefined && { llmsFullTxtUrl: llmsProbe.llmsFullTxtUrl }),
      githubUrl: crate.repository?.includes("github.com") ? crate.repository : undefined,
      score: 60,
      source: "crates",
    };

    resolveCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

async function resolveFromGo(moduleName: string): Promise<LibraryMatch | null> {
  const cacheKey = `go-resolve:${moduleName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  const pageUrl = `https://pkg.go.dev/${moduleName}`;
  const content = await fetchViaJina(pageUrl);
  if (!content) return null;

  const descMatch = content.match(/^(.{20,300})/m);
  const description = descMatch?.[1]?.trim() ?? "";

  const result: LibraryMatch = {
    id: `go:${moduleName}`,
    name: moduleName,
    description,
    docsUrl: pageUrl,
    llmsTxtUrl: undefined,
    githubUrl: moduleName.startsWith("github.com/") ? `https://${moduleName}` : undefined,
    score: 55,
    source: "go",
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
      description: `Resolve a library or framework name to a WS-compatible ID and documentation URL. Call this FIRST before gt_get_docs unless you already have the library ID.

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
      const name = libraryName.trim();

      if (isExtractionAttempt(name) || (query !== undefined && isExtractionAttempt(query))) {
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
