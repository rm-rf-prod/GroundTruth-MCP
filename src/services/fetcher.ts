/**
 * Public surface of the fetch layer.
 *
 * The implementation lives in focused modules (http/*, content-guards, doc-fetch,
 * github, packages, sitemap, llms-index). This barrel is the single import path
 * every tool and test uses, so internals can be reorganised without touching
 * ~30 call sites or their mocks.
 */
export { fetchSemaphore } from "./http/semaphore.js";
export { isBlockedIP } from "./http/ssrf.js";
export { clearNegativeCache } from "./http/negative-cache.js";
export { fetchWithTimeout, githubAuthHeaders, hashContent } from "./http/request.js";
export { fetchViaJina } from "./http/jina.js";
export { docsifyToRaw, fetchAsMarkdown, fetchAsMarkdownRace } from "./http/markdown.js";
export {
  isHtmlBlob,
  isErrorPage,
  isLoginWall,
  isCloudflareChallenge,
  isRateLimitPage,
  isMarketingPage,
  isEmptySPAShell,
  isGarbageContent,
} from "./content-guards.js";
export { isIndexContent, rankIndexLinks } from "./llms-index.js";
export { fetchDocs } from "./doc-fetch.js";
export { fetchGitHubContent, fetchGitHubReleases, fetchGitHubExamples } from "./github.js";
export { fetchNpmPackage, fetchPypiPackage, fetchDevDocs } from "./packages.js";
export { fetchSitemapUrls } from "./sitemap.js";
