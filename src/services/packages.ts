import { CACHE_TTLS } from "../constants.js";
import { docCache, diskDocCache } from "./cache.js";
import { cacheDoc } from "./http/request.js";
import { tryFetch } from "./http/try-fetch.js";
import { fetchViaJina } from "./http/jina.js";
import { isErrorPage } from "./content-guards.js";

/** Query npm registry for package metadata */
export async function fetchNpmPackage(packageName: string): Promise<unknown> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const cacheKey = `npm:${packageName}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) {
    try {
      return JSON.parse(memCached) as unknown;
    } catch { /* corrupt cache entry — fall through to disk/network */ }
  }

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    try {
      const parsed = JSON.parse(diskCached) as unknown;
      docCache.set(cacheKey, diskCached);
      return parsed;
    } catch { /* corrupt cache entry — fall through to network */ }
  }

  const content = await tryFetch(url);
  if (!content) return null;

  try {
    const data = JSON.parse(content);
    docCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    void diskDocCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    return data as unknown;
  } catch {
    return null;
  }
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

  const memCached = docCache.get(cacheKey);
  if (memCached) return memCached;

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    docCache.set(cacheKey, diskCached);
    return diskCached;
  }

  // Try topic-specific doc page first, then root page
  const topicSlug = topic ? topic.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : "";
  const urls = topic
    ? [
        `https://devdocs.io/${slugEncoded}/${topicSlug}`,
        `https://devdocs.io/${slugEncoded}/`,
      ]
    : [`https://devdocs.io/${slugEncoded}/`];

  for (const url of urls) {
    const content = await fetchViaJina(url);
    if (content && content.length >= 200 && !isErrorPage(content)) {
      cacheDoc(cacheKey, content, CACHE_TTLS.DEVDOCS);
      return content;
    }
  }
  return null;
}
/** Query PyPI for package metadata */
export async function fetchPypiPackage(packageName: string): Promise<unknown> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
  const cacheKey = `pypi:${packageName}`;

  const memCached = docCache.get(cacheKey);
  if (memCached) {
    try {
      return JSON.parse(memCached) as unknown;
    } catch { /* corrupt cache entry — fall through to disk/network */ }
  }

  const diskCached = await diskDocCache.get(cacheKey);
  if (diskCached) {
    try {
      const parsed = JSON.parse(diskCached) as unknown;
      docCache.set(cacheKey, diskCached);
      return parsed;
    } catch { /* corrupt cache entry — fall through to network */ }
  }

  const content = await tryFetch(url);
  if (!content) return null;

  try {
    const data = JSON.parse(content);
    docCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    void diskDocCache.set(cacheKey, content, CACHE_TTLS.PACKAGE_METADATA);
    return data as unknown;
  } catch {
    return null;
  }
}
