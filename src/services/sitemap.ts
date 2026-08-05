import { CACHE_TTLS } from "../constants.js";
import { docCache, diskDocCache } from "./cache.js";
import { tryFetch } from "./http/try-fetch.js";

/** Fetch and parse sitemap.xml to discover all doc page URLs */
export async function fetchSitemapUrls(docsUrl: string): Promise<string[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(docsUrl);
  } catch {
    return [];
  }
  const origin = parsedUrl.origin;

  // Path-hosted docs (docs.swmansion.com/react-native-reanimated/) publish
  // their sitemap under the project path, not the domain root — try the
  // path-scoped location first, then fall back to the root.
  const firstSegment = parsedUrl.pathname.split("/").filter(Boolean)[0];
  const sitemapCandidates = firstSegment
    ? [`${origin}/${firstSegment}/sitemap.xml`, `${origin}/sitemap.xml`]
    : [`${origin}/sitemap.xml`];

  const cacheKey = `sitemap:${origin}:${firstSegment ?? ""}`;
  const memCached = docCache.get(cacheKey);
  if (memCached) {
    try {
      const parsed: unknown = JSON.parse(memCached);
      if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === "string")) {
        return parsed;
      }
    } catch { /* invalid cache — fall through to re-fetch */ }
  }

  const locRegex = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/g;
  const urls: string[] = [];
  for (const sitemapUrl of sitemapCandidates) {
    const content = await tryFetch(sitemapUrl, 0);
    if (!content) continue;
    let match;
    while ((match = locRegex.exec(content)) !== null && urls.length < 500) {
      const url = match[1]?.trim();
      if (url && /\/(docs?|guide|api|reference|learn|tutorial)\//i.test(url)) {
        urls.push(url);
      }
    }
    if (urls.length > 0) break;
    locRegex.lastIndex = 0;
  }

  if (urls.length > 0) {
    docCache.set(cacheKey, JSON.stringify(urls), CACHE_TTLS.SITEMAP);
    void diskDocCache.set(cacheKey, JSON.stringify(urls), CACHE_TTLS.SITEMAP);
  }

  return urls;
}
