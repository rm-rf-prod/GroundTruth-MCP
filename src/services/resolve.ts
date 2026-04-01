import { fetchNpmPackage, fetchPypiPackage, fetchWithTimeout, fetchAsMarkdownRace } from "./fetcher.js";
import { resolveCache } from "./cache.js";
import type { LibraryMatch, NpmPackageInfo, PypiPackageInfo } from "../types.js";
import { assertPublicUrl } from "../utils/guard.js";

export interface ResolvedLibrary {
  docsUrl: string;
  displayName: string;
  githubUrl?: string;
  llmsTxtUrl?: string;
  llmsFullTxtUrl?: string;
}

function buildResolved(
  docsUrl: string,
  displayName: string,
  githubUrl: string | undefined,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
): ResolvedLibrary {
  const r: ResolvedLibrary = { docsUrl, displayName };
  if (githubUrl !== undefined) r.githubUrl = githubUrl;
  if (llmsTxtUrl !== undefined) r.llmsTxtUrl = llmsTxtUrl;
  if (llmsFullTxtUrl !== undefined) r.llmsFullTxtUrl = llmsFullTxtUrl;
  return r;
}

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

export async function probeLlmsTxt(homepage: string): Promise<{ llmsTxtUrl?: string; llmsFullTxtUrl?: string }> {
  try { assertPublicUrl(homepage); } catch { return {}; }

  const cacheKey = `llms-probe:${new URL(homepage).origin}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached as { llmsTxtUrl?: string; llmsFullTxtUrl?: string };

  const result: { llmsTxtUrl?: string; llmsFullTxtUrl?: string } = {};
  const [fullResult, txtResult] = await Promise.allSettled([
    fetchWithTimeout(`${homepage}/llms-full.txt`, 5000),
    fetchWithTimeout(`${homepage}/llms.txt`, 5000),
  ]);
  if (fullResult.status === "fulfilled" && fullResult.value.ok) {
    result.llmsFullTxtUrl = `${homepage}/llms-full.txt`;
  }
  if (txtResult.status === "fulfilled" && txtResult.value.ok) {
    result.llmsTxtUrl = `${homepage}/llms.txt`;
  }

  resolveCache.set(cacheKey, result as unknown as LibraryMatch);
  return result;
}

export function extractGithubUrl(repoField: unknown): string | undefined {
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

export async function resolveFromNpm(packageName: string): Promise<LibraryMatch | null> {
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

export async function resolveFromPypi(packageName: string): Promise<LibraryMatch | null> {
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

export async function resolveFromCrates(packageName: string): Promise<LibraryMatch | null> {
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

export async function resolveFromGo(moduleName: string): Promise<LibraryMatch | null> {
  const cacheKey = `go-resolve:${moduleName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  const pageUrl = `https://pkg.go.dev/${moduleName}`;
  const content = await fetchAsMarkdownRace(pageUrl);
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

/**
 * Resolve a dynamic library ID (npm:pkg, pypi:pkg, crates:pkg, go:module, URL, or bare name)
 * to docs metadata. Returns null if resolution fails entirely.
 */
export async function resolveDynamic(libraryId: string): Promise<ResolvedLibrary | null> {
  const cacheKey = `dynamic-resolve:${libraryId}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) {
    return buildResolved(cached.docsUrl, cached.name, cached.githubUrl, cached.llmsTxtUrl, cached.llmsFullTxtUrl);
  }

  let match: LibraryMatch | null = null;

  if (libraryId.startsWith("npm:")) {
    match = await resolveFromNpm(libraryId.slice(4));
  } else if (libraryId.startsWith("pypi:")) {
    match = await resolveFromPypi(libraryId.slice(5));
  } else if (libraryId.startsWith("crates:")) {
    match = await resolveFromCrates(libraryId.slice(7));
  } else if (libraryId.startsWith("go:")) {
    match = await resolveFromGo(libraryId.slice(3));
  } else if (libraryId.startsWith("http://") || libraryId.startsWith("https://")) {
    try {
      assertPublicUrl(libraryId);
    } catch {
      return null;
    }
    const hostname = new URL(libraryId).hostname;
    const llmsProbe = await probeLlmsTxt(libraryId.replace(/\/+$/, ""));
    return buildResolved(libraryId, hostname, undefined, llmsProbe.llmsTxtUrl, llmsProbe.llmsFullTxtUrl);
  } else if (libraryId.includes(".") && !libraryId.includes(" ")) {
    // Looks like a hostname (e.g., "fastify.dev")
    const url = `https://${libraryId}`;
    try {
      assertPublicUrl(url);
    } catch {
      return null;
    }
    const llmsProbe = await probeLlmsTxt(url);
    return buildResolved(url, libraryId, undefined, llmsProbe.llmsTxtUrl, llmsProbe.llmsFullTxtUrl);
  } else {
    // Bare name: try npm first, then pypi
    const [npmResult, pypiResult] = await Promise.all([
      resolveFromNpm(libraryId),
      resolveFromPypi(libraryId),
    ]);
    match = npmResult ?? pypiResult;

    if (!match) {
      // Try crates.io and Go as last resort
      const [cratesResult, goResult] = await Promise.all([
        resolveFromCrates(libraryId),
        resolveFromGo(libraryId),
      ]);
      match = cratesResult ?? goResult;
    }
  }

  if (!match) return null;

  return buildResolved(match.docsUrl, match.name, match.githubUrl, match.llmsTxtUrl, match.llmsFullTxtUrl);
}
