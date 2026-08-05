import { lookupById } from "../sources/registry.js";
import { fetchDocs, fetchGitHubReleases, fetchAsMarkdownRace, isIndexContent, rankIndexLinks } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence } from "../utils/evidence.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { FIX_TARGET_GROUPS, PYTHON_FIX_URLS, KEYWORD_TO_LIB } from "../sources/audit-fix-urls.js";

/**
 * Fetch + evidence-gate a guidance page. Index pages, search results and
 * off-topic articles fail checkEvidence (zero topic-term coverage) and are
 * dropped — the pattern's built-in fix text stands instead of generic filler.
 */
async function fetchGuidance(url: string, query: string, tokens: number): Promise<string> {
  const raw = await fetchAsMarkdownRace(url);
  if (!raw) return "";
  const { text } = extractRelevantContent(sanitizeContent(raw), query, tokens);
  if (text.length <= 200) return "";
  if (checkEvidence(text, query).matchRatio === 0) return "";
  return `_Source: ${url} (fetched live)_\n\n${text}`;
}

/** Registry-backed lookup for findings that name a library we already track. */
async function fetchFromRegistry(query: string, tokens: number): Promise<string> {
  for (const [re, libId] of KEYWORD_TO_LIB) {
    if (!re.test(query)) continue;
    const entry = lookupById(libId);
    if (!entry) continue;
    try {
      let result = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl, query);
      if (isIndexContent(result.content)) {
        const deepLinks = rankIndexLinks(result.content, query, result.url || entry.docsUrl);
        for (const deepUrl of deepLinks) {
          const deepContent = await fetchAsMarkdownRace(deepUrl);
          if (deepContent && deepContent.length > 300) {
            result = { content: deepContent, url: deepUrl, sourceType: "jina" };
            break;
          }
        }
      }
      const safe = sanitizeContent(result.content);
      const { text } = extractRelevantContent(safe, query, tokens);
      // Evidence gate: docs that never mention the finding's terms are
      // generic filler — reject and keep hunting instead of returning them.
      if (text.length > 200 && checkEvidence(text, query).matchRatio > 0) {
        return `_Source: ${result.url} (fetched live)_\n\n${text}`;
      }
    } catch {
      // continue to the release-notes fallback
    }
    if (entry.githubUrl) {
      const releases = await fetchGitHubReleases(entry.githubUrl);
      if (releases) {
        const { text } = extractRelevantContent(sanitizeContent(releases), query, Math.floor(tokens / 2));
        if (text.length > 100 && checkEvidence(text, query).matchRatio > 0) {
          return `_Source: ${entry.githubUrl}/releases — release notes for context, not a how-to guide_\n\n${text}`;
        }
      }
    }
  }
  return "";
}

/** Curated deep links per finding class, with a broader page as fallback. */
async function fetchFromCuratedDocs(query: string, tokens: number): Promise<string> {
  for (const group of FIX_TARGET_GROUPS) {
    if (!group.match.test(query)) continue;
    for (const [re, url] of group.targets) {
      if (!re.test(query)) continue;
      const text = await fetchGuidance(url, query, tokens);
      if (text.length > 0) return text;
      break; // most specific target matched but came back empty — go broad
    }
    const fallback = await fetchGuidance(
      group.fallback.replace("{q}", encodeURIComponent(query)),
      query,
      tokens,
    );
    if (fallback.length > 0) return fallback;
  }
  return "";
}

/** Python findings check the security sheet and the style guide in parallel. */
async function fetchPythonGuidance(query: string, tokens: number): Promise<string> {
  if (!PYTHON_FIX_URLS.match.test(query)) return "";
  const [security, style] = await Promise.allSettled([
    fetchGuidance(PYTHON_FIX_URLS.security, query, tokens),
    fetchGuidance(PYTHON_FIX_URLS.style, query, tokens),
  ]);
  const securityText = security.status === "fulfilled" ? security.value : "";
  if (securityText.length > 0) return securityText;
  return style.status === "fulfilled" ? style.value : "";
}

/**
 * Live remediation guidance for one audit finding. Returns "" when nothing
 * on-topic could be verified — callers fall back to the pattern's own fix text
 * rather than serving generic filler.
 */
export async function fetchBestPractice(query: string, tokens: number): Promise<string> {
  const fromRegistry = await fetchFromRegistry(query, tokens);
  if (fromRegistry.length > 0) return fromRegistry;

  const fromDocs = await fetchFromCuratedDocs(query, tokens);
  if (fromDocs.length > 0) return fromDocs;

  return fetchPythonGuidance(query, tokens);
}
