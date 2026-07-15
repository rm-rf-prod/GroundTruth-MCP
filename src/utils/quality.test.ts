import { describe, it, expect } from "vitest";
import { computeQualityScore } from "./quality.js";

describe("computeQualityScore", () => {
  const richContent = `# React Hooks Guide

## useState
\`\`\`typescript
const [count, setCount] = useState(0);
\`\`\`

## useEffect
Side effects in functional components.

## useRef
Access DOM elements directly.
` + "x".repeat(500);

  it("returns high score for well-structured content matching topic", () => {
    const { score } = computeQualityScore(richContent, "react hooks", "llms-txt");
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it("returns lower score for content not matching topic", () => {
    const { score } = computeQualityScore(richContent, "database migrations", "llms-txt");
    expect(score).toBeLessThanOrEqual(0.6);
  });

  it("penalizes very short content", () => {
    const { score } = computeQualityScore("Short text", "react", "llms-txt");
    expect(score).toBeLessThan(0.5);
  });

  it("weights source type correctly", () => {
    const content = "# Guide\n\nSome authentication content.\n" + "x".repeat(500);
    const { score: llmsScore } = computeQualityScore(content, "authentication", "llms-txt");
    const { score: directScore } = computeQualityScore(content, "authentication", "direct");
    expect(llmsScore).toBeGreaterThan(directScore);
  });

  it("returns score between 0 and 1", () => {
    const { score } = computeQualityScore("anything", "anything", "jina");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("handles empty topic gracefully", () => {
    const { score } = computeQualityScore(richContent, "", "llms-txt");
    expect(score).toBeGreaterThan(0);
  });

  it("rewards code blocks in content", () => {
    const withCode = "# Guide\n```js\ncode\n```\n" + "x".repeat(500);
    const withoutCode = "# Guide\nPlain text only\n" + "x".repeat(500);
    const { score: scoreWith } = computeQualityScore(withCode, "guide", "jina");
    const { score: scoreWithout } = computeQualityScore(withoutCode, "guide", "jina");
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it("returns hints when quality dimensions are low", () => {
    const { hints } = computeQualityScore("Short", "nonexistent topic xyz", "npm");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some((h) => h.includes("specific topic"))).toBe(true);
  });

  it("returns empty hints for high-quality content", () => {
    const { hints } = computeQualityScore(richContent, "react hooks", "llms-txt");
    expect(hints).toEqual([]);
  });

  it("collapses score for version-mismatched content even when topic matches (gt_migration P0)", () => {
    const ancient =
      `# Migration Guide: upgrade from version 8 to 9\n\n## withAmp removed\nUse the config object instead.\n\n## @zeit/next-typescript\nRemove this package.\n` +
      "x".repeat(500);
    const { score, hints } = computeQualityScore(ancient, "migration upgrade", "github-readme", ["15", "16"]);
    expect(score).toBeLessThan(0.4);
    expect(hints.some((h) => h.includes("requested version"))).toBe(true);
  });

  it("keeps a high score when content names the requested version", () => {
    const onTarget =
      `# v16 Migration Guide\n\nTo upgrade, run npm install next@16.\n\n## Cache Components\n\`\`\`ts\nexport const config = {};\n\`\`\`\n\n## Async params\nawait params now.\n` +
      "x".repeat(500);
    const { score } = computeQualityScore(onTarget, "migration upgrade", "github-readme", ["15", "16"]);
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it("ignores version relevance when no targetVersions are passed (back-compat)", () => {
    const a = computeQualityScore(richContent, "react hooks", "llms-txt").score;
    const b = computeQualityScore(richContent, "react hooks", "llms-txt", []).score;
    expect(a).toBe(b);
  });

  // lengthScore band cutoffs: <200 -> 0.2, <500 -> 0.5, <=15000 -> 1.0, <=30000 -> 0.8, else 0.6.
  // Topic "" forces topicCoverage=1; sourceType "direct" pins sourceScore=0.5; plain "x" content
  // has no headings/code/lists/year mentions, holding every other score term constant so only
  // the length band moves the final score across each cutoff.
  it.each([
    [199, 0.55],
    [200, 0.6],
    [499, 0.6],
    [500, 0.67],
    [15000, 0.67],
    [15001, 0.64],
    [30000, 0.64],
    [30001, 0.61],
  ])("pins the lengthScore band transition at len=%i", (len, expected) => {
    const { score } = computeQualityScore("x".repeat(len), "", "direct");
    expect(score).toBeCloseTo(expected, 5);
  });
});
