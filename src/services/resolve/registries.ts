import { fetchNpmPackage, fetchPypiPackage, fetchWithTimeout, fetchAsMarkdownRace } from "../fetcher.js";
import { CACHE_TTLS } from "../../constants.js";
import { resolveCache } from "../cache.js";
import type { LibraryMatch, NpmPackageInfo, PypiPackageInfo } from "../../types.js";
import { log } from "../../utils/logger.js";
import { probeLlmsTxt } from "./llms-probe.js";

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
  // Verify the response actually carries a string name before trusting the cast
  // (fetchNpmPackage returns unknown; a malformed API body must not slip through).
  if (!("name" in data) || typeof (data as Record<string, unknown>).name !== "string") return null;

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

  resolveCache.set(cacheKey, result, CACHE_TTLS.RESOLVE);
  return result;
}

export async function resolveFromPypi(packageName: string): Promise<LibraryMatch | null> {
  const cacheKey = `pypi-resolve:${packageName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  const data = await fetchPypiPackage(packageName);
  if (!data || typeof data !== "object") return null;
  // Verify the response carries an info object before trusting the cast.
  if (!("info" in data) || typeof (data as Record<string, unknown>).info !== "object" || (data as Record<string, unknown>).info === null) return null;

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
    ...(llmsProbe.llmsFullTxtUrl !== undefined && { llmsFullTxtUrl: llmsProbe.llmsFullTxtUrl }),
    githubUrl:
      info.project_urls?.["Source"] ??
      info.project_urls?.["Repository"] ??
      info.project_urls?.["GitHub"],
    score: 65,
    source: "pypi",
  };

  resolveCache.set(cacheKey, result, CACHE_TTLS.RESOLVE);
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

    resolveCache.set(cacheKey, result, CACHE_TTLS.RESOLVE);
    return result;
  } catch (err) {
    log({ level: "debug", msg: "resolve.external_lookup_failed", cacheKey, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * pkg.go.dev returns HTTP 200 with a "404 Not Found" body for unknown modules.
 * Detect that page so callers do not get a garbage match.
 */
function isGoPkgNotFound(content: string): boolean {
  const head = content.slice(0, 1500).toLowerCase();
  // Common pkg.go.dev 404 signals — title contains "404 Not Found" and
  // body mentions the redirect / search-help text.
  if (/title:\s*404 not found\b/i.test(content.slice(0, 500))) return true;
  if (/404 not found - go packages/i.test(head)) return true;
  if (head.includes("could not find") && head.includes("pkg.go.dev")) return true;
  return false;
}

export async function resolveFromGo(moduleName: string): Promise<LibraryMatch | null> {
  const cacheKey = `go-resolve:${moduleName}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) return cached;

  const pageUrl = `https://pkg.go.dev/${moduleName}`;
  const content = await fetchAsMarkdownRace(pageUrl);
  if (!content) return null;

  // pkg.go.dev serves a 200-OK 404 page for unknown modules — reject it so we
  // do not surface "Title: 404 Not Found - Go Packages" as a real result.
  if (isGoPkgNotFound(content)) return null;

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

  resolveCache.set(cacheKey, result, CACHE_TTLS.RESOLVE);
  return result;
}
