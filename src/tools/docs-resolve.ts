import { lookupById, lookupByAlias } from "../sources/registry.js";
import { probeLlmsTxt } from "../services/resolve.js";
import { assertPublicUrl } from "../utils/guard.js";
import type { LibraryEntry } from "../types.js";

export interface DocsTarget {
  docsUrl: string;
  llmsTxtUrl: string | undefined;
  llmsFullTxtUrl: string | undefined;
  githubUrl: string | undefined;
  displayName: string;
}

export function resolveLibraryFromId(libraryId: string): LibraryEntry | null {
  // Direct registry ID, then alias
  return lookupById(libraryId) ?? lookupByAlias(libraryId) ?? null;
}

/**
 * Validate an npm / PyPI package name for safe URL construction.
 * Allows an optional @scope/ prefix and the standard name charset; rejects path
 * traversal (.., //), protocol-relative input, and over-long names. Preserves
 * valid scoped packages that encodeURIComponent would otherwise corrupt.
 */
export function isValidPackageName(pkg: string): boolean {
  if (!pkg || pkg.length > 214) return false;
  if (pkg.includes("..") || pkg.includes("//")) return false;
  return /^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/i.test(pkg);
}

/**
 * Turn a libraryId into the URLs gt_get_docs should fetch. Returns a plain
 * message string when the identifier is unusable (invalid name, private target),
 * so the caller can surface it verbatim without throwing.
 */
export async function resolveDocsTarget(
  libraryId: string,
  entry: LibraryEntry | null,
): Promise<DocsTarget | string> {
  if (entry) {
    let llmsTxtUrl = entry.llmsTxtUrl;
    let llmsFullTxtUrl = entry.llmsFullTxtUrl;
    // Lazy llms.txt discovery for registry entries missing the URL
    if (!llmsTxtUrl && !llmsFullTxtUrl) {
      const probed = await probeLlmsTxt(entry.docsUrl);
      if (probed.llmsTxtUrl) llmsTxtUrl = probed.llmsTxtUrl;
      if (probed.llmsFullTxtUrl) llmsFullTxtUrl = probed.llmsFullTxtUrl;
    }
    return {
      docsUrl: entry.docsUrl,
      llmsTxtUrl,
      llmsFullTxtUrl,
      githubUrl: entry.githubUrl,
      displayName: entry.name,
    };
  }

  const bare = { llmsTxtUrl: undefined, llmsFullTxtUrl: undefined, githubUrl: undefined };

  // Direct URL provided — validate it is not an internal/private target.
  // Scheme-anchored: bare names like "http-errors" must fall through to
  // the package-name branches, not hard-fail as malformed URLs.
  if (libraryId.startsWith("http://") || libraryId.startsWith("https://")) {
    try {
      assertPublicUrl(libraryId);
    } catch {
      return `URL not allowed: must be a public HTTPS address.`;
    }
    return { ...bare, docsUrl: libraryId, displayName: new URL(libraryId).hostname };
  }

  if (libraryId.startsWith("npm:")) {
    const pkg = libraryId.slice(4);
    if (!isValidPackageName(pkg)) return `Invalid npm package name: "${pkg}".`;
    return { ...bare, docsUrl: `https://www.npmjs.com/package/${pkg}`, displayName: pkg };
  }

  if (libraryId.startsWith("pypi:")) {
    const pkg = libraryId.slice(5);
    if (!isValidPackageName(pkg)) return `Invalid PyPI package name: "${pkg}".`;
    return { ...bare, docsUrl: `https://pypi.org/project/${pkg}`, displayName: pkg };
  }

  // Try as URL or library name fallback
  if (libraryId.includes(".")) {
    const candidateUrl = `https://${libraryId}`;
    try {
      // Hard SSRF gate — refuse any libraryId that resolves to a private/internal target
      assertPublicUrl(candidateUrl);
    } catch {
      return `URL not allowed: "${libraryId}" resolves to a private/internal target. Must be a public host.`;
    }
    return { ...bare, docsUrl: candidateUrl, displayName: libraryId };
  }

  if (!isValidPackageName(libraryId)) return `Invalid library name: "${libraryId}".`;
  return { ...bare, docsUrl: `https://www.npmjs.com/package/${libraryId}`, displayName: libraryId };
}
