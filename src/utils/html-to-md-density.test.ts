import { describe, it, expect } from "vitest";
import { convertHtmlToMarkdown, looksLikeHtml, markupDensity } from "./html-to-md.js";

// A Next.js App Router page: real markup, then a large inline RSC/hydration
// payload that drags the raw tag density below the markdown threshold.
const article = Array.from({ length: 12 }, (_, i) =>
  `<h2>Section ${i}</h2><p>Request memoization dedupes fetch calls in one render pass, number ${i}.</p>`,
).join("");
const payload = '0:["$","div",null,{"children":"x"}]'.repeat(6000);
const rscPage =
  `<!DOCTYPE html><html><head><title>Caching</title></head><body><main><h1>Caching in Next.js</h1>${article}</main>` +
  `<script>self.__next_f.push([1, ${JSON.stringify(payload)}])</script>` +
  `<style>${".a{color:red}".repeat(2000)}</style></body></html>`;

describe("markupDensity (NET-01)", () => {
  it("ignores <script> and <style> bodies", () => {
    const raw = (rscPage.match(/<[a-z]/gi) ?? []).length / rscPage.length;
    expect(raw).toBeLessThan(0.005);
    expect(markupDensity(rscPage)).toBeGreaterThan(0.005);
  });
});

describe("looksLikeHtml (NET-01, NET-04)", () => {
  it("treats an HTML document as HTML whatever its density", () => {
    expect(looksLikeHtml(`<!doctype html><html><body>${"text ".repeat(5000)}</body></html>`)).toBe(true);
  });

  it("trusts a markdown or plain-text content type over tag density", () => {
    const mdx = `---\ntitle: JSX\n---\n<Intro>\n${"<div><b>x</b></div>\n".repeat(50)}</Intro>`;
    expect(looksLikeHtml(mdx)).toBe(true);
    expect(looksLikeHtml(mdx, "text/markdown; charset=utf-8")).toBe(false);
    expect(looksLikeHtml(mdx, "text/plain; charset=utf-8")).toBe(false);
  });

  it("still treats a mislabeled HTML document as HTML", () => {
    expect(looksLikeHtml("<!DOCTYPE html><html><body><p>x</p></body></html>", "text/plain")).toBe(true);
  });

  it("treats plain markdown as markdown", () => {
    expect(looksLikeHtml(`# Title\n\n${"Some prose with `code`.\n".repeat(40)}`)).toBe(false);
  });
});

describe("convertHtmlToMarkdown on script-heavy SSR pages (NET-01)", () => {
  it("extracts the article instead of returning the raw HTML", () => {
    const md = convertHtmlToMarkdown(rscPage);
    expect(md).toContain("# Caching in Next.js");
    expect(md).toContain("## Section 11");
    expect(md).not.toContain("<!DOCTYPE");
    expect(md).not.toContain("__next_f");
  });
});
