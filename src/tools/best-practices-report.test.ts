import { describe, it, expect } from "vitest";
import { renderBestPractices } from "./best-practices-report.js";
import { checkEvidence } from "../utils/evidence.js";

const text = "## Locators\n\nPrefer user-facing locators. Locators auto-wait. Chain locators to narrow scope.";
const render = (truncated: boolean): string =>
  renderBestPractices({
    displayName: "Playwright",
    resolvedId: "microsoft/playwright",
    topic: "locators",
    text,
    sourceUrl: "https://playwright.dev/docs/locators",
    truncated,
    sourceType: "direct",
    evidence: checkEvidence(text, "locators"),
    escalated: false,
    sourcesTried: [{ url: "https://playwright.dev/docs/locators" }],
  }).content[0]!.text;

describe("renderBestPractices header", () => {
  it("separates the header from the first heading", () => {
    expect(render(false)).toContain("---\n\n## Locators");
  });

  it("asks for a narrower topic, not a bigger budget, when content was left out", () => {
    const out = render(true);
    expect(out).toContain("More matching sections were truncated; narrow the topic.");
    expect(out).not.toContain("increase tokens");
  });
});
