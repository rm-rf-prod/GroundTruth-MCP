import { describe, it, expect } from "vitest";
import { stripNoisyElements } from "./clean.js";

describe("stripNoisyElements", () => {
  it("keeps content whose class merely contains a noise substring", () => {
    const out = stripNoisyElements('<main class="has-sidebar"><h1>Title Here</h1><p>Intro</p></main><div class="read-more"><p>Real doc text</p></div>');
    expect(out).toContain("Title Here");
    expect(out).toContain("Real doc text");
  });
  it("removes a whole noisy element including nested same-tag children", () => {
    const out = stripNoisyElements('<div class="sidebar"><div>inner</div><a>link</a></div><p>keep</p>');
    expect(out).toBe("<p>keep</p>");
  });
  it("keeps a noise-classed wrapper that holds the article", () => {
    const out = stripNoisyElements('<div class="page-with-toc"><article><h1>Guide</h1><p>Body</p></article></div>');
    expect(out).toContain("Body");
  });
  it("keeps a div wrapper with a state-modifier class and no article inside", () => {
    const out = stripNoisyElements('<div class="has-sidebar layout"><div class="content"><p>Real doc text</p></div></div>');
    expect(out).toContain("Real doc text");
  });
  it("still removes noise whose own name comes before a modifier, or uses is-", () => {
    const out = stripNoisyElements('<div class="nav-with-search">menu</div><div class="is-modal">pop</div><div class="sidebar"><h1>Widget</h1></div><p>keep</p>');
    expect(out).toBe("<p>keep</p>");
  });
  it("stays linear on many unclosed noisy tags", () => {
    const html = '<div class="ad"><p>x</p>'.repeat(20_000);
    const start = performance.now();
    stripNoisyElements(html);
    expect(performance.now() - start).toBeLessThan(2000);
  });
  it("drops only the opening tag of an unclosed noisy element", () => {
    const out = stripNoisyElements('<ul><li class="nav-item">Home<li>Other</ul><p>Real doc text</p>');
    expect(out).toContain("Real doc text");
  });
});
