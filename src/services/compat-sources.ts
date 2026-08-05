import { fetchAsMarkdownRace } from "./fetcher.js";
import { fetchMdnDocMeta, renderBcdTable, formatBaseline } from "./mdn-bcd.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence } from "../utils/evidence.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { findTopicUrls } from "./search/topic-match.js";
import { searchMDN } from "./search/engines.js";

export interface CompatSection {
  text: string;
  url: string;
  sourceType: string;
}

/**
 * Resolve real MDN document URLs for a feature: curated topic map first, then
 * MDN's official search JSON API. Reference pages carry the compat data; guides
 * rarely do, so reference pages are probed first.
 */
export async function resolveMdnCandidates(feature: string): Promise<string[]> {
  const candidates: string[] = findTopicUrls(feature)
    .flatMap((t) => t.urls)
    .filter((u) => u.includes("mozilla.org"));
  // Always append MDN search hits: topic-map entries are often GUIDE pages
  // that carry no BCD paths — the reference page (with the compat table)
  // only surfaces via search.
  for (const hit of (await searchMDN(feature)).slice(0, 5)) {
    if (!candidates.includes(hit.url)) candidates.push(hit.url);
  }
  const isGuideUrl = (u: string): boolean => /\/(Guides?|Learn)\//i.test(u);
  return candidates.sort((a, b) => Number(isGuideUrl(a)) - Number(isGuideUrl(b)));
}

/**
 * PRIMARY path: MDN machine-readable data. {doc}/index.json carries the summary,
 * Baseline status, and the BCD query paths; the BCD API returns exact per-browser
 * version_added (incl. Node/Deno/Bun). Rendered-page scraping loses these tables.
 *
 * Metadata for every candidate is fetched in ONE round, then evaluated in
 * priority order. Sequentially awaiting six 10s-timeout fetches could reach 60s —
 * past this tool's own 55s ceiling, so a slow MDN made the whole call time out.
 */
export async function fetchBcdSection(
  candidates: string[],
  feature: string,
  environments: string[] | undefined,
): Promise<CompatSection | null> {
  const candidateUrls = candidates.slice(0, 6);
  const metas = await Promise.all(candidateUrls.map((u) => fetchMdnDocMeta(u).catch(() => null)));

  for (const [i, candidateUrl] of candidateUrls.entries()) {
    const meta = metas[i];
    if (!meta || meta.browserCompat.length === 0) continue;
    // Relevance gate: the resolved doc must actually be about the feature.
    if (checkEvidence(`${meta.title}\n${meta.summary}`, feature).matchRatio === 0) continue;

    const tables = (
      await Promise.all(meta.browserCompat.slice(0, 3).map((p) => renderBcdTable(p, environments)))
    ).filter((t): t is string => t !== null);
    if (tables.length === 0) continue;

    const baselineLine = formatBaseline(meta.baseline);
    const text = [
      `## MDN Web Docs — ${meta.title || feature}`,
      "",
      meta.summary,
      baselineLine ? `\n**${baselineLine}**` : "",
      "",
      tables.join("\n\n"),
      "",
      "(Live browser-compat data from MDN BCD.)",
    ]
      .filter((l) => l !== "")
      .join("\n");
    return { text, url: candidateUrl, sourceType: "mdn-bcd" };
  }
  return null;
}

/** Fetch one page, extract against a topic, and keep it only if it covers the feature. */
async function fetchGatedSection(
  url: string,
  feature: string,
  topic: string,
  tokens: number,
  heading: string,
  sourceType: string,
): Promise<CompatSection | null> {
  const content = await fetchAsMarkdownRace(url);
  if (!content || content.length <= 200) return null;
  const { text } = extractRelevantContent(sanitizeContent(content), topic, tokens);
  if (text.length <= 100 || checkEvidence(text, feature).matchRatio === 0) return null;
  return { text: `${heading}\n\n${text}`, url, sourceType };
}

/** Fallback: rendered MDN page via markdown conversion. */
export async function fetchRenderedMdn(
  candidates: string[],
  feature: string,
  topic: string,
  tokens: number,
): Promise<CompatSection | null> {
  for (const url of candidates.slice(0, 2)) {
    const section = await fetchGatedSection(url, feature, topic, tokens, "## MDN Web Docs", "mdn");
    if (section) return section;
  }
  return null;
}

/** caniuse.com — especially useful for CSS and browser-specific APIs. */
export function fetchCaniuse(feature: string, tokens: number): Promise<CompatSection | null> {
  const url = `https://caniuse.com/?search=${encodeURIComponent(feature)}`;
  return fetchGatedSection(url, feature, `${feature} browser support`, tokens, "## Can I Use", "caniuse");
}

/** Last resort: the MDN search results page — a link list, not a compat table. */
export function fetchMdnSearchPage(feature: string, topic: string, tokens: number): Promise<CompatSection | null> {
  const url = `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(feature)}+browser+compatibility`;
  return fetchGatedSection(
    url,
    feature,
    topic,
    tokens,
    "## MDN search results (weak evidence — follow the links for compat tables)",
    "mdn-search",
  );
}
