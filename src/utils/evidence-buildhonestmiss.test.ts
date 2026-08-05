import { describe, it, expect } from "vitest";
import {
  checkEvidence,
  buildEvidenceBlock,
  buildHonestMiss,
  extractHeadingOutline,
} from "./evidence.js";

describe("buildHonestMiss", () => {
  it("states the miss explicitly with tried sources and outline", () => {
    const miss = buildHonestMiss({
      subject: "pino",
      topic: "named export pattern",
      tried: ["https://getpino.io/#/docs/web", "https://getpino.io/#/docs/web", "https://github.com/pinojs/pino"],
      outline: ["Install", "Usage"],
    });
    expect(miss).toContain("no topic-specific evidence found");
    expect(miss).toContain('"named export pattern"');
    expect(miss).toContain("Sources checked:");
    expect((miss.match(/getpino\.io\/#\/docs\/web/g) ?? []).length).toBe(1);
    expect(miss).toContain("What the fetched documentation DOES cover:");
    expect(miss).toContain("- Install");
    expect(miss).toContain("What to try next:");
  });

  it("supports custom next steps", () => {
    const miss = buildHonestMiss({
      subject: "x",
      topic: "y",
      tried: ["https://x.dev"],
      nextSteps: ["Do the thing"],
    });
    expect(miss).toContain("- Do the thing");
  });
});

describe("checkEvidence meta-token filtering", () => {
  it("fails off-topic content that only matches query-meta words", () => {
    // A web-performance page must not pass a Postgres RLS query just because
    // both say "best practices" and "performance".
    const cwvContent = [
      "# Web performance best practices",
      "",
      "Optimize LCP and INP. Follow these best practices for Core Web Vitals.",
      "Performance best practices matter. More performance guidance below.",
    ].join("\n");
    const r = checkEvidence(cwvContent, "postgres row level security best practices");
    expect(r.ok).toBe(false);
    expect(r.matchRatio).toBe(0);
  });

  it("still passes when substantive tokens are covered", () => {
    const content = "# Row Level Security\n\nEnable row level security on every table. Postgres row level security policies below.";
    const r = checkEvidence(content, "postgres row level security best practices");
    expect(r.ok).toBe(true);
  });
});
