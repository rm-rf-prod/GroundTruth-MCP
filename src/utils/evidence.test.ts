import { describe, it, expect } from "vitest";
import {
  checkEvidence,
  buildEvidenceBlock,
  buildHonestMiss,
  extractHeadingOutline,
} from "./evidence.js";

describe("checkEvidence", () => {
  it("passes with no topic (nothing to verify)", () => {
    const r = checkEvidence("any content at all", "");
    expect(r.ok).toBe(true);
    expect(r.matchRatio).toBe(1);
  });

  it("fails a single passing mention of a single-token topic", () => {
    const content = "This library does many things. It supports logging too. Install with npm.";
    const r = checkEvidence(content, "logging");
    expect(r.ok).toBe(false);
    expect(r.occurrences).toBe(1);
  });

  it("passes a single-token topic with repeated occurrences", () => {
    const content = "Logging setup. Configure logging levels. Logging transports explained.";
    const r = checkEvidence(content, "logging");
    expect(r.ok).toBe(true);
    expect(r.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("passes a single-token topic appearing in a heading", () => {
    const content = "# Logging\n\nOne section about it.";
    const r = checkEvidence(content, "logging");
    expect(r.ok).toBe(true);
    expect(r.topicInHeading).toBe(true);
  });

  it("passes a single-token topic appearing in code", () => {
    const content = "Some prose.\n\n```js\nconst middleware = createMiddleware();\n```";
    const r = checkEvidence(content, "middleware");
    expect(r.ok).toBe(true);
    expect(r.topicInCode).toBe(true);
  });

  it("fails multi-token topic when under half the tokens match", () => {
    const content = "Routing routing routing everywhere in this guide about routing.";
    const r = checkEvidence(content, "authentication session cookies routing");
    expect(r.matchRatio).toBeLessThan(0.5);
    expect(r.ok).toBe(false);
    expect(r.missingTokens).toContain("authentication");
  });

  it("passes multi-token topic with coverage and heading presence", () => {
    const content = "# Authentication\n\nSession management uses cookies. Authentication flows below.";
    const r = checkEvidence(content, "authentication session");
    expect(r.ok).toBe(true);
    expect(r.matchRatio).toBe(1);
  });

  it("fails entirely off-topic content", () => {
    const content = "# Welcome\n\nFast, small, flexible. Star us on GitHub. MIT license.";
    const r = checkEvidence(content, "named export pattern");
    expect(r.ok).toBe(false);
    expect(r.matchRatio).toBe(0);
    expect(r.occurrences).toBe(0);
  });

  it("caps occurrence counting (no unbounded scan)", () => {
    const content = "cache ".repeat(10_000);
    const r = checkEvidence(content, "cache");
    expect(r.occurrences).toBeLessThanOrEqual(50);
    expect(r.ok).toBe(true);
  });

  it("does not count topic tokens that appear only inside link URLs", () => {
    // Regression: a 404 page whose nav/footer links carry utm_campaign=docs_guides_performance
    // scored "strong" for topic "performance" because tokens were counted in raw URLs.
    const content = [
      "# 404",
      "",
      "## This page could not be found.",
      "",
      "[Next.js + Vercel](https://vercel.com/solutions/nextjs?utm_campaign=docs_guides_performance)",
      "[Open Source](https://vercel.com/oss?utm_campaign=docs_guides_performance)",
      "[GitHub](https://github.com/vercel?utm_campaign=docs_guides_performance)",
      "![logo](https://nextjs.org/logo.svg?utm_campaign=docs_guides_performance)",
      "Bare link: https://vercel.com/legal?utm_campaign=docs_guides_performance",
    ].join("\n");
    const r = checkEvidence(content, "performance");
    expect(r.occurrences).toBe(0);
    expect(r.ok).toBe(false);
  });

  it("accepts docs vocabulary for an acronym topic ('rls' -> 'row level security')", () => {
    const content = [
      "## Row level security",
      "",
      "Enable row level security on every table. Row level security policies run per statement.",
      "A row level security policy is evaluated for each row.",
    ].join("\n");
    const r = checkEvidence(content, "rls");
    expect(r.ok).toBe(true);
    expect(r.matchedTokens).toContain("rls");
  });

  it("does not count a topic token buried mid-word ('rls' inside 'urls')", () => {
    const content = [
      "## Configuring urls",
      "",
      "Set the urls option. The urls array accepts absolute urls only.",
      "Absolute urls are required because relative urls break redirects.",
    ].join("\n");
    const r = checkEvidence(content, "rls");
    expect(r.occurrences).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.missingTokens).toContain("rls");
  });

  it("counts a topic token at a camelCase hump ('performance' in reportPerformance)", () => {
    const content = ["```js", "reportPerformance();", "```"].join("\n");
    const r = checkEvidence(content, "performance");
    expect(r.topicInCode).toBe(true);
  });

  it("still counts topic tokens in link text, prose, headings, and code", () => {
    const content = [
      "## Performance guide",
      "",
      "Measure performance before optimizing. See [performance tips](https://example.com/a1b2).",
      "",
      "```js",
      "reportPerformance();",
      "```",
    ].join("\n");
    const r = checkEvidence(content, "performance");
    expect(r.ok).toBe(true);
    expect(r.topicInHeading).toBe(true);
    expect(r.topicInCode).toBe(true);
    expect(r.occurrences).toBeGreaterThanOrEqual(3);
  });
});

describe("buildEvidenceBlock", () => {
  it("includes sources, dedupes, and reports topic coverage", () => {
    const check = checkEvidence("# Caching\ncaching caching", "caching");
    const block = buildEvidenceBlock({
      sources: [
        { url: "https://a.dev/docs", sourceType: "llms-txt", fetchedAt: "2026-06-12T00:00:00Z" },
        { url: "https://a.dev/docs" },
        { url: "https://b.dev/guide" },
      ],
      topic: "caching",
      check,
    });
    expect(block).toContain("## Evidence");
    expect(block).toContain("https://a.dev/docs (llms-txt, fetched 2026-06-12)");
    expect(block).toContain("https://b.dev/guide");
    expect((block.match(/https:\/\/a\.dev\/docs/g) ?? []).length).toBe(1);
    expect(block).toContain("Topic coverage: 1/1 terms");
    expect(block).toContain("Fetched live");
  });

  it("notes escalation and missing terms", () => {
    const check = checkEvidence("only sessions here, sessions again, more sessions", "sessions oauth");
    const block = buildEvidenceBlock({
      sources: [{ url: "https://x.dev" }],
      topic: "sessions oauth",
      check,
      escalated: true,
    });
    expect(block).toContain("deep fetch");
    expect(block).toContain("Terms not found in source: oauth");
  });
});

describe("extractHeadingOutline", () => {
  it("returns cleaned heading list, capped", () => {
    const content = Array.from({ length: 12 }, (_, i) => `## Section ${i}\nbody`).join("\n");
    const outline = extractHeadingOutline(content, 5);
    expect(outline).toHaveLength(5);
    expect(outline[0]).toBe("Section 0");
  });

  it("returns empty for heading-less content", () => {
    expect(extractHeadingOutline("plain prose only")).toEqual([]);
  });
});
