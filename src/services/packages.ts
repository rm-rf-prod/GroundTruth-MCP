import { CACHE_TTLS } from "../constants.js";
import { docCache, diskDocCache } from "./cache.js";
import { cacheDoc, inFlightRequests } from "./http/request.js";
import { tryFetch } from "./http/try-fetch.js";
import { fetchViaJina } from "./http/jina.js";
import { readCached, readThrough } from "./http/swr.js";
import { singleFlight } from "./http/single-flight.js";
import { isErrorPage } from "./content-guards.js";

/** Parsed JSON, or undefined for a missing or corrupt body. */
function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Registry metadata JSON, cached raw (cacheDoc's sanitizer would corrupt it).
 * A stale entry is served while it refreshes; a corrupt one is refetched.
 */
async function fetchJsonMeta(url: string, cacheKey: string): Promise<unknown> {
  const fresh = (): Promise<string | null> => singleFlight(inFlightRequests, cacheKey, async () => {
    const content = await tryFetch(url);
    if (content === null || parseJson(content) === undefined) return null;
    docCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    void diskDocCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    return content;
  });
  return parseJson(await readCached(cacheKey, fresh)) ?? parseJson(await fresh()) ?? null;
}

/** Query npm registry for package metadata */
export async function fetchNpmPackage(packageName: string): Promise<unknown> {
  return fetchJsonMeta(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, `npm:${packageName}`);
}

const DEVDOCS_SLUGS: Record<string, string> = {
  react: "react", node: "node", python: "python~3.12", go: "go",
  typescript: "typescript", javascript: "javascript", rust: "rust",
  css: "css", html: "html", postgresql: "postgresql~16", redis: "redis",
  mongodb: "mongodb", docker: "docker", nginx: "nginx", git: "git",
  bash: "bash", ruby: "ruby~3.3", php: "php", java: "openjdk~21",
  kotlin: "kotlin", swift: "swift", dart: "dart~3", elixir: "elixir",
  django: "django~5.0", flask: "flask~3.0", express: "express",
  vue: "vue~3", angular: "angular", svelte: "svelte",
  tailwindcss: "tailwindcss", rails: "ruby_on_rails~7.1", laravel: "laravel~11",
};

/** Fetch documentation from devdocs.io — pre-parsed, offline-capable docs for 200+ technologies */
export async function fetchDevDocs(slug: string, topic?: string): Promise<string | null> {
  const resolvedSlug = DEVDOCS_SLUGS[slug.toLowerCase()] ?? slug.toLowerCase();
  const slugEncoded = encodeURIComponent(resolvedSlug);
  const cacheKey = `devdocs:${slugEncoded}:${topic ?? ""}`;

  // Try topic-specific doc page first, then root page
  const topicSlug = topic ? topic.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : "";
  const urls = topic
    ? [
        `https://devdocs.io/${slugEncoded}/${topicSlug}`,
        `https://devdocs.io/${slugEncoded}/`,
      ]
    : [`https://devdocs.io/${slugEncoded}/`];

  return readThrough(cacheKey, async () => {
    for (const url of urls) {
      const content = await fetchViaJina(url);
      if (content && content.length >= 200 && !isErrorPage(content)) return content;
    }
    return null;
  }, (c) => cacheDoc(cacheKey, c, CACHE_TTLS.DEVDOCS));
}
/** Query PyPI for package metadata */
export async function fetchPypiPackage(packageName: string): Promise<unknown> {
  return fetchJsonMeta(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`, `pypi:${packageName}`);
}
