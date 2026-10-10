import { CACHE_TTLS } from "../constants.js";
import { docCache, diskDocCache } from "./cache.js";
import { tryFetch } from "./http/try-fetch.js";
import { readCached } from "./http/swr.js";
import { singleFlight } from "./http/single-flight.js";
import { isGitHubHost } from "./github.js";

/** Bounds what one docs path keeps after scoping; tanstack.com alone lists 5,000+ pages. */
const MAX_SITEMAP_URLS = 2000;
/** Sites with no usable sitemap are re-checked hourly instead of on every call. */
const EMPTY_SITEMAP_TTL_MS = 60 * 60 * 1000;

const inFlight = new Map<string, Promise<string[]>>();

function parseUrlList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === "string")) return parsed;
  } catch { /* invalid cache — fall through to re-fetch */ }
  return undefined;
}

/** Fetch and parse sitemap.xml to discover all doc page URLs */
export async function fetchSitemapUrls(docsUrl: string): Promise<string[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(docsUrl);
  } catch {
    return [];
  }
  // A repo has no sitemap of its own; github.com's sitemaps index GitHub itself.
  if (isGitHubHost(docsUrl)) return [];
  const origin = parsedUrl.origin;

  // Path-hosted docs (docs.swmansion.com/react-native-reanimated/) publish
  // their sitemap under the project path, not the domain root — try the
  // path-scoped location first, then fall back to the root.
  const firstSegment = parsedUrl.pathname.split("/").filter(Boolean)[0];
  const sitemapCandidates = firstSegment
    ? [`${origin}/${firstSegment}/sitemap.xml`, `${origin}/sitemap.xml`]
    : [`${origin}/sitemap.xml`];

  const cacheKey = `sitemap:${origin}:${firstSegment ?? ""}`;
  const download = async (): Promise<string[]> => {
    const locRegex = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/g;
    let urls: string[] = [];
    for (const sitemapUrl of sitemapCandidates) {
      const content = await tryFetch(sitemapUrl, 0);
      if (!content) continue;
      let match;
      while ((match = locRegex.exec(content)) !== null) {
        const url = match[1]?.trim();
        if (url && /\/(docs?|guide|api|reference|learn|tutorial)\//i.test(url)) {
          urls.push(url);
        }
      }
      if (urls.length > 0) break;
      locRegex.lastIndex = 0;
    }

    // Multi-product domains (tanstack.com: query, router, start) list every
    // product in one sitemap; keep the library's own docs path when it has any.
    if (firstSegment) {
      const scoped = urls.filter((u) => u.replace(/^https?:\/\/[^/]+/, "").startsWith(`/${firstSegment}/`));
      if (scoped.length > 0) urls = scoped;
    }
    urls = urls.slice(0, MAX_SITEMAP_URLS);

    const ttl = urls.length > 0 ? CACHE_TTLS.SITEMAP : EMPTY_SITEMAP_TTL_MS;
    docCache.set(cacheKey, JSON.stringify(urls), ttl);
    void diskDocCache.set(cacheKey, JSON.stringify(urls), ttl);
    return urls;
  };
  const refresh = (): Promise<string[]> => singleFlight(inFlight, cacheKey, download);
  // A corrupt cached list reads as a miss and is downloaded again.
  return parseUrlList(await readCached(cacheKey, refresh)) ?? refresh();
}
