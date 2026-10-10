import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { convertHtmlToMarkdown, visibleTextLength } from "./html-to-md.js";

// Trimmed copies of real pages (head, scripts, styles, svg and Tailwind variant classes removed).
const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const page = (body: string): string => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
const filler = "<p>Prose that explains the example so the page clears the converter's length floor.</p>";

/** Every fence must open or close at the start of a line, and they must pair up. */
function expectBalancedFences(md: string): void {
  expect(md.match(/.```/g) ?? []).toEqual([]);
  expect((md.match(/^```/gm) ?? []).length % 2).toBe(0);
}

describe("convertHtmlToMarkdown on real pages", () => {
  it("keeps every step of tailwindcss.com/docs/installation/using-vite, not just the lead paragraph", () => {
    const md = convertHtmlToMarkdown(fixture("tailwind-install.html"));
    for (const step of ["Create your project", "Install Tailwind CSS", "Configure the Vite plugin",
      "Import Tailwind CSS", "Start your build process", "Start using Tailwind in your HTML"]) {
      expect(md).toContain(step);
    }
    expect(md).toContain("npm install tailwindcss @tailwindcss/vite");
    expect(md).toContain("import { defineConfig } from 'vite'\nimport tailwindcss from '@tailwindcss/vite'");
    expectBalancedFences(md);
  });

  it("puts every zod.dev/api fence on its own line", () => {
    const md = convertHtmlToMarkdown(fixture("zod-api-urls.html"));
    expect(md).toContain("z.httpUrl();");
    expect(md).toMatch(/\*\*Web URLs\*\* — In many cases/);
    expectBalancedFences(md);
  });
});

describe("convertHtmlToMarkdown structure", () => {
  it("never reads <button>, <br> or <img> as bold or italic", () => {
    const md = convertHtmlToMarkdown(page(`<main><button>Copy</button><p>Start <img src="a.png"> here</p>${filler}<p>Then <strong>this</strong> part<br>and <em>that</em>.</p></main>`));
    expect(md).toContain("**this**");
    expect(md).toContain("*that*");
    expect(md).not.toMatch(/\*\*Copy|\*Start/);
  });

  it("opens a code fence on its own line inside a list item or a bold run", () => {
    const md = convertHtmlToMarkdown(page(`<main><ul><li>Run:<pre><code>npm test</code></pre></li></ul><p><b>Note:</b></p><pre><code>x</code></pre>${filler}</main>`));
    expect(md).toContain("\n```\nnpm test\n```");
    expectBalancedFences(md);
  });

  it("keeps code indentation and blank lines, and one line per highlighted line span", () => {
    const code = '<span class="line">def f():</span><span class="line">    return 1</span><span class="line"></span><span class="line">f()</span>';
    const md = convertHtmlToMarkdown(page(`<main><pre class="shiki"><code>${code}</code></pre>${filler}</main>`));
    expect(md).toContain("```\ndef f():\n    return 1\n\nf()\n```");
  });

  it("decodes code entities exactly once", () => {
    const md = convertHtmlToMarkdown(page(`<main><pre><code>&lt;div&gt; &amp;lt;p&amp;gt;</code></pre>${filler}</main>`));
    expect(md).toContain("<div> &lt;p&gt;");
  });

  it("uses a longer fence when the code itself contains one", () => {
    const md = convertHtmlToMarkdown(page(`<main><pre><code>\`\`\`js\nx\n\`\`\`</code></pre>${filler}</main>`));
    expect(md).toContain("````\n```js\nx\n```\n````");
  });

  it("falls back to the page body when the content container holds only a fragment of the text", () => {
    const steps = Array.from({ length: 12 }, (_, i) => `<div class="step"><h4>Step ${i}</h4><p>Detailed instruction number ${i} for the installation.</p></div>`).join("");
    const lead = "<p>Lead paragraph of the guide, the only text inside the prose block of this page. </p>".repeat(3);
    const md = convertHtmlToMarkdown(page(`<nav>Docs Blog</nav><div class="prose">${lead}</div>${steps}`));
    expect(md).toContain("Lead paragraph");
    expect(md).toContain("Step 11");
    expect(md).not.toContain("Docs Blog");
  });

  it("keeps the content container when it holds most of the text", () => {
    const md = convertHtmlToMarkdown(page(`<div class="banner-x">Ad text</div><main><h1>Guide</h1>${filler.repeat(4)}</main><div>Small aside</div>`));
    expect(md).toContain("# Guide");
    expect(md).not.toContain("Small aside");
  });
});

describe("visibleTextLength", () => {
  it("counts text a reader sees, without markup, scripts, styles or whitespace", () => {
    expect(visibleTextLength(`<p>ab <b>c</b></p><script>var x = 1;</script><style>p{}</style>\n d`)).toBe(4);
  });
});
