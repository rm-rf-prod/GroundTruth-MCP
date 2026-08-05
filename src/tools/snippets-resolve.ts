import { lookupById, lookupByAlias } from "../sources/registry.js";
import { assertPublicUrl } from "../utils/guard.js";
import { isValidPackageName } from "./docs-resolve.js";

export interface SnippetTarget {
  library: string;
  displayName: string;
  docsUrl: string;
  llmsTxtUrl: string | undefined;
  llmsFullTxtUrl: string | undefined;
  githubUrl: string | undefined;
}

export function resolveLibraryEntry(libraryId: string) {
  return lookupById(libraryId) ?? lookupByAlias(libraryId);
}

/**
 * Resolve a libraryId to the sources gt_snippets should index. Returns a plain
 * message string when the identifier is unusable, so the caller surfaces it verbatim.
 */
export function resolveSnippetTarget(libraryId: string): SnippetTarget | string {
  const entry = resolveLibraryEntry(libraryId);
  if (entry) {
    return {
      library: entry.id,
      displayName: entry.name,
      docsUrl: entry.docsUrl,
      llmsTxtUrl: entry.llmsTxtUrl,
      llmsFullTxtUrl: entry.llmsFullTxtUrl,
      githubUrl: entry.githubUrl,
    };
  }

  const bare = { llmsTxtUrl: undefined, llmsFullTxtUrl: undefined, githubUrl: undefined };

  // npm:/pypi: IDs are documented in this tool's own schema — resolve
  // them the same way gt_get_docs does instead of refusing.
  if (libraryId.startsWith("npm:")) {
    const pkg = libraryId.slice(4);
    if (!isValidPackageName(pkg)) return `Invalid npm package name: "${pkg}".`;
    return { ...bare, library: libraryId, docsUrl: `https://www.npmjs.com/package/${pkg}`, displayName: pkg };
  }

  if (libraryId.startsWith("pypi:")) {
    const pkg = libraryId.slice(5);
    if (!isValidPackageName(pkg)) return `Invalid PyPI package name: "${pkg}".`;
    return { ...bare, library: libraryId, docsUrl: `https://pypi.org/project/${pkg}`, displayName: pkg };
  }

  if (libraryId.startsWith("http://") || libraryId.startsWith("https://")) {
    try {
      assertPublicUrl(libraryId);
    } catch {
      return "URL not allowed: must be a public HTTPS address.";
    }
    return { ...bare, library: libraryId, docsUrl: libraryId, displayName: new URL(libraryId).hostname };
  }

  return `Could not resolve "${libraryId}". Run gt_resolve_library first.`;
}
