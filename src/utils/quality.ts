import { tokenize } from "./extract.js";

const SOURCE_WEIGHTS: Record<string, number> = {
  "llms-txt": 1.0,
  "llms-full-txt": 1.0,
  "deep-fetch": 0.9,
  "jina": 0.8,
  "github-readme": 0.7,
  "direct": 0.5,
  "npm": 0.4,
};

export function computeQualityScore(
  content: string,
  topic: string,
  sourceType: string,
): number {
  const topicTokens = tokenize(topic);
  let topicCoverage = 1;
  if (topicTokens.length > 0) {
    const contentLower = content.toLowerCase();
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

  const score =
    topicCoverage * 0.35 +
    structureScore * 0.2 +
    sourceScore * 0.2 +
    lengthScore * 0.15 +
    freshnessBonus +
    codeDensityBonus +
    listBonus;

  return Math.round(Math.min(score, 1) * 100) / 100;
}
