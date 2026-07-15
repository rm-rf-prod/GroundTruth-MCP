import { substantiveTokens } from "./extract.js";
import { stripUrlNoise } from "./evidence.js";

export interface QualityResult {
  score: number;
  hints: string[];
}

const SOURCE_WEIGHTS: Record<string, number> = {
  "llms-txt": 1.0,
  "llms-full-txt": 1.0,
  "deep-fetch": 0.9,
  "jina": 0.8,
  "github-readme": 0.7,
  "direct": 0.5,
  "npm": 0.4,
};

/**
 * Score how strongly the content matches the requested version(s).
 * Returns 1 when no versions are requested (preserves prior behaviour for
 * every non-version tool). Otherwise it looks for the target versions in the
 * leading third of the content — where a correct migration/changelog names its
 * target — and returns 0.3 on a complete miss so version-mismatched docs
 * collapse below the trust threshold instead of being stamped ~0.96.
 */
function computeVersionRelevance(content: string, versions: string[]): number {
  const norms = versions.map((v) => v.replace(/^v/i, "").trim()).filter(Boolean);
  if (norms.length === 0) return 1;
  const head = content.slice(0, Math.max(400, Math.floor(content.length / 3)));
  let hits = 0;
  for (const v of norms) {
    // Escape ALL regex metacharacters (not just dots) before building a dynamic
    // RegExp from caller-supplied version text — prevents ReDoS / pattern injection.
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Boundary guards stop "15" matching inside "2015" or "150".
    if (new RegExp(`(?<![\\d.])${esc}(?![\\d])`).test(head)) hits += 1;
  }
  if (hits === 0) return 0.3;
  return 0.7 + 0.3 * (hits / norms.length);
}

export function computeQualityScore(
  content: string,
  topic: string,
  sourceType: string,
  targetVersions?: string[],
): QualityResult {
  // Same meta-word-filtered token set as checkEvidence — the quality footer
  // and the evidence footer must not disagree about subject coverage.
  const topicTokens = substantiveTokens(topic);
  let topicCoverage = 1;
  if (topicTokens.length > 0) {
    // Same URL stripping as checkEvidence — a token appearing only inside link
    // hrefs must not inflate qualityScore while the evidence gate reports a miss.
    const contentLower = stripUrlNoise(content).toLowerCase();
    const found = topicTokens.filter((t) => contentLower.includes(t)).length;
    topicCoverage = found / topicTokens.length;
  }

  const headings = (content.match(/^#{1,4}\s+.+$/gm) ?? []).length;
  const codeBlocks = (content.match(/```/g) ?? []).length / 2;
  const hasStructure = headings >= 2 ? 1 : headings >= 1 ? 0.6 : 0.2;
  const hasCode = codeBlocks >= 1 ? 1 : 0.5;
  const structureScore = (hasStructure + hasCode) / 2;

  const sourceScore = SOURCE_WEIGHTS[sourceType] ?? 0.5;

  const len = content.length;
  let lengthScore: number;
  if (len < 200) lengthScore = 0.2;
  else if (len < 500) lengthScore = 0.5;
  else if (len <= 15000) lengthScore = 1.0;
  else if (len <= 30000) lengthScore = 0.8;
  else lengthScore = 0.6;

  // Freshness: boost content mentioning recent years
  const currentYear = new Date().getFullYear();
  const recentYears = [currentYear, currentYear - 1];
  const freshnessBonus = recentYears.some((y) => content.includes(String(y))) ? 0.05 : 0;

  // Code density: best-practices content typically has examples
  const codeDensity = len > 0 ? Math.min(codeBlocks / (len / 2000), 1) : 0;
  const codeDensityBonus = codeDensity > 0.3 ? 0.05 : codeDensity > 0.1 ? 0.02 : 0;

  // List structure: ordered/unordered lists indicate actionable content
  const listItems = (content.match(/^[\s]*[-*]|\d+\.\s/gm) ?? []).length;
  const listBonus = listItems >= 5 ? 0.05 : listItems >= 2 ? 0.02 : 0;

  const rawScore =
    topicCoverage * 0.35 +
    structureScore * 0.2 +
    sourceScore * 0.2 +
    lengthScore * 0.15 +
    freshnessBonus +
    codeDensityBonus +
    listBonus;

  // When the caller asks about specific versions (gt_migration 15 -> 16),
  // content that never names the target version is almost always the wrong
  // band — multiply the score down rather than reporting a misleading high one.
  const versionFactor =
    targetVersions && targetVersions.length > 0
      ? computeVersionRelevance(content, targetVersions)
      : 1;
  const score = rawScore * versionFactor;

  const hints: string[] = [];
  if (versionFactor < 0.5) {
    hints.push("Content does not reference the requested version -- it may be from a different release; verify against the official upgrade guide");
  }
  if (topicCoverage < 0.5) hints.push("Try a more specific topic");
  if (sourceScore < 0.6) hints.push("Try gt_resolve_library for a more accurate library ID");
  if (lengthScore < 0.5) hints.push("Content is sparse -- try gt_search for alternative sources");
  if (hasStructure < 0.6) hints.push("Content lacks structure -- may be a README, try the official docs URL directly");

  return { score: Math.round(Math.min(score, 1) * 100) / 100, hints };
}
