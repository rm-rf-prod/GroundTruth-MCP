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
    const score = computeQualityScore(richContent, "react hooks", "llms-txt");
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it("returns lower score for content not matching topic", () => {
    const score = computeQualityScore(richContent, "database migrations", "llms-txt");
    expect(score).toBeLessThanOrEqual(0.6);
  });

  it("penalizes very short content", () => {
    const score = computeQualityScore("Short text", "react", "llms-txt");
    expect(score).toBeLessThan(0.5);
  });

  it("weights source type correctly", () => {
    const content = "# Guide\n\nSome authentication content.\n" + "x".repeat(500);
    const llmsScore = computeQualityScore(content, "authentication", "llms-txt");
    const directScore = computeQualityScore(content, "authentication", "direct");
    expect(llmsScore).toBeGreaterThan(directScore);
  });

  it("returns score between 0 and 1", () => {
    const score = computeQualityScore("anything", "anything", "jina");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("handles empty topic gracefully", () => {
    const score = computeQualityScore(richContent, "", "llms-txt");
    expect(score).toBeGreaterThan(0);
  });

  it("rewards code blocks in content", () => {
    const withCode = "# Guide\n```js\ncode\n```\n" + "x".repeat(500);
    const withoutCode = "# Guide\nPlain text only\n" + "x".repeat(500);
    const scoreWith = computeQualityScore(withCode, "guide", "jina");
    const scoreWithout = computeQualityScore(withoutCode, "guide", "jina");
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });
});
