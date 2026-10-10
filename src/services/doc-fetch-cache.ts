import type { FetchResult } from "../types.js";
import { docCache, diskDocCache } from "./cache.js";
import { cacheDoc, hashContent } from "./http/request.js";
import { readCached } from "./http/swr.js";

/**
 * A docs result is cached as three entries under one key: the content, its
 * source type and the URL actually fetched (nested llms.txt, raw README), so a
 * warm call reports the same Source as the cold one.
 */
const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set(["llms-txt", "llms-full-txt", "jina", "direct", "github-readme"]);

export function stamp(result: FetchResult): FetchResult {
  return { ...result, contentHash: hashContent(result.content), fetchedAt: new Date().toISOString() };
}

// Cache hits must report the ORIGINAL fetch origin, not a hardcoded
// "llms-txt" — quality scoring downstream weights source types differently.
// Companion entry absent (pre-fix cache files) falls back to llms-txt.
function asSourceType(raw: string | undefined): FetchResult["sourceType"] {
  return raw && VALID_SOURCE_TYPES.has(raw) ? (raw as FetchResult["sourceType"]) : "llms-txt";
}

export function cacheDocs(key: string, result: FetchResult, ttl: number): FetchResult {
  cacheDoc(key, result.content, ttl);
  for (const [suffix, value] of [[":sourceType", result.sourceType], [":url", result.url]] as const) {
    docCache.set(key + suffix, value, ttl);
    void diskDocCache.set(key + suffix, value, ttl);
  }
  return stamp(result);
}

/** The companions expire with the content, and the content's refresh rewrites them. */
const companionRefresh = async (): Promise<void> => {};

/** Cached result under `key`, stale ones served at once while `refresh` replaces them in the background. */
export async function readDocs(key: string, fallbackUrl: string, refresh: () => Promise<unknown>): Promise<FetchResult | undefined> {
  const content = await readCached(key, refresh);
  if (content === undefined) return undefined;
  const sourceType = asSourceType(await readCached(`${key}:sourceType`, companionRefresh));
  const url = (await readCached(`${key}:url`, companionRefresh)) ?? fallbackUrl;
  return stamp({ content, url, sourceType });
}
