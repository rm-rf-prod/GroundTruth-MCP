import { fetchWithTimeout } from "../fetcher.js";
import { llmsProbeCache } from "../cache.js";
import { assertPublicUrl } from "../../utils/guard.js";

/**
 * Normalize a homepage URL for safe path concatenation.
 * Strips URL fragment (#readme) + query (?utm) + trailing slashes — these break
 * `${homepage}/llms.txt` style concat by producing URLs like
 * `https://github.com/x/y#readme/llms.txt` (invalid).
 */
function normalizeHomepageForProbe(homepage: string): string | null {
  try {
    const u = new URL(homepage);
    u.hash = "";
    u.search = "";
    // Strip trailing slashes from pathname (keep "/" if pathname IS just "/")
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function probeLlmsTxt(homepage: string): Promise<{ llmsTxtUrl?: string; llmsFullTxtUrl?: string }> {
  const base = normalizeHomepageForProbe(homepage);
  if (!base) return {};
  try { assertPublicUrl(base); } catch { return {}; }

  // Key on the full normalized base path, not just the origin: two libraries on
  // the same host (docs.example.com/react vs /vue) must not share a probe result.
  const cacheKey = `llms-probe:${base}`;
  const cached = llmsProbeCache.get(cacheKey);
  if (cached) return cached;

  const result: { llmsTxtUrl?: string; llmsFullTxtUrl?: string } = {};
  // Sites publish these at the root OR under /docs (firebase.google.com serves
  // /docs/llms.txt and 404s at the root). fetchDocs already probed both; this
  // path only checked the root, so registry lazy-fill under-covered it.
  const candidates = [
    { full: `${base}/llms-full.txt`, txt: `${base}/llms.txt` },
    { full: `${base}/docs/llms-full.txt`, txt: `${base}/docs/llms.txt` },
  ];
  for (const candidate of candidates) {
    const [fullResult, txtResult] = await Promise.allSettled([
      fetchWithTimeout(candidate.full, 5000),
      fetchWithTimeout(candidate.txt, 5000),
    ]);
    if (!result.llmsFullTxtUrl && fullResult.status === "fulfilled" && fullResult.value.ok) {
      result.llmsFullTxtUrl = candidate.full;
    }
    if (!result.llmsTxtUrl && txtResult.status === "fulfilled" && txtResult.value.ok) {
      result.llmsTxtUrl = candidate.txt;
    }
    if (result.llmsTxtUrl || result.llmsFullTxtUrl) break;
  }

  llmsProbeCache.set(cacheKey, result);
  return result;
}
