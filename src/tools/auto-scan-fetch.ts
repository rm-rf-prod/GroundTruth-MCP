import { lookupByAlias, lookupById, fuzzySearch } from "../sources/registry.js";
import { fetchDocs, fetchAsMarkdownRace, isIndexContent, rankIndexLinks } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import type { LibraryEntry } from "../types.js";

export interface LibraryResult {
  name: string;
  content: string;
  url: string;
  failed?: boolean;
}

/** Server-wide FetchSemaphore caps at 12, so 8 leaves headroom for other tools. */
function concurrency(): number {
  const raw = parseInt(process.env.GT_CONCURRENCY ?? "8", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 12) : 8;
}

export function matchDepToRegistry(depName: string): LibraryEntry | null {
  // exact alias first
  const byAlias = lookupByAlias(depName);
  if (byAlias) return byAlias;

  // strip scope from scoped packages (@scope/name -> name)
  if (depName.startsWith("@")) {
    const unscoped = depName.split("/")[1];
    if (unscoped) {
      const byScopedAlias = lookupByAlias(unscoped);
      if (byScopedAlias) return byScopedAlias;
    }
  }

  // fuzzy — only use if score is high enough (first result, short names only)
  const fuzzy = fuzzySearch(depName, 1);
  if (fuzzy.length > 0 && fuzzy[0]) {
    const entry = lookupById(fuzzy[0].id);
    if (entry) return entry;
  }

  return null;
}

async function fetchOneLibrary(
  entry: LibraryEntry,
  enrichedTopic: string,
  tokensPerLib: number,
): Promise<LibraryResult> {
  try {
    let fetchResult = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl, enrichedTopic);
    if (isIndexContent(fetchResult.content)) {
      const deepLinks = rankIndexLinks(fetchResult.content, enrichedTopic, fetchResult.url || entry.docsUrl);
      for (const deepUrl of deepLinks.slice(0, 3)) {
        const deepContent = await fetchAsMarkdownRace(deepUrl);
        if (deepContent && deepContent.length > 300) {
          fetchResult = { content: deepContent, url: deepUrl, sourceType: "jina" };
          break;
        }
      }
    }
    const { text } = extractRelevantContent(sanitizeContent(fetchResult.content), enrichedTopic, tokensPerLib);
    return { name: entry.name, content: text, url: fetchResult.url };
  } catch {
    // Marked failed so the resolveRate telemetry doesn't count
    // laundered placeholders as successes.
    return { name: entry.name, content: `Could not fetch docs for ${entry.name}.`, url: entry.docsUrl, failed: true };
  }
}

/** Fetch best practices for every matched library in bounded parallel batches. */
export async function fetchLibraryBatches(
  matched: Array<{ dep: string; entry: LibraryEntry }>,
  versions: Map<string, string>,
  topic: string,
  tokensPerLib: number,
  results: LibraryResult[],
): Promise<void> {
  const batchSize = concurrency();
  for (let i = 0; i < matched.length; i += batchSize) {
    const batch = matched.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(({ dep, entry }) => {
        const version = versions.get(dep);
        const enrichedTopic = version
          ? `${topic} v${version} best practices patterns guide`
          : `${topic} best practices patterns guide`;
        return fetchOneLibrary(entry, enrichedTopic, tokensPerLib);
      }),
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
}
