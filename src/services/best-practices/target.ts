import { lookupById, lookupByAlias } from "../../sources/registry.js";
import { resolveDynamic } from "../resolve.js";

export interface BestPracticesTarget {
  docsUrl: string;
  llmsTxtUrl: string | undefined;
  llmsFullTxtUrl: string | undefined;
  githubUrl: string | undefined;
  displayName: string;
  bestPracticesPaths: string[] | undefined;
  urlPatterns: string[] | undefined;
  resolvedId: string;
}

/**
 * Resolve a library identifier to everything the best-practices fetch needs.
 * Accepts registry IDs, aliases, and dynamic (npm/PyPI/URL) identifiers.
 * Returns null when the identifier cannot be resolved at all.
 */
export async function resolveBestPracticesTarget(libraryId: string): Promise<BestPracticesTarget | null> {
  const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);

  if (entry) {
    // Entries without llms URLs are not probed here: fetchDocs discovers llms
    // files in parallel with the page fetch, where a probe first was serial.
    return {
      docsUrl: entry.docsUrl,
      llmsTxtUrl: entry.llmsTxtUrl,
      llmsFullTxtUrl: entry.llmsFullTxtUrl,
      githubUrl: entry.githubUrl,
      displayName: entry.name,
      bestPracticesPaths: entry.bestPracticesPaths,
      urlPatterns: entry.urlPatterns,
      resolvedId: entry.id,
    };
  }

  const resolved = await resolveDynamic(libraryId);
  if (!resolved) return null;
  return {
    docsUrl: resolved.docsUrl,
    llmsTxtUrl: resolved.llmsTxtUrl,
    llmsFullTxtUrl: resolved.llmsFullTxtUrl,
    githubUrl: resolved.githubUrl,
    displayName: resolved.displayName,
    bestPracticesPaths: undefined,
    urlPatterns: undefined,
    resolvedId: libraryId,
  };
}
