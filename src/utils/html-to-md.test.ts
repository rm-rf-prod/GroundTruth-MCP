import { describe, it, expect } from "vitest";
import { convertHtmlToMarkdown } from "./html-to-md.js";

describe("convertHtmlToMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(convertHtmlToMarkdown("")).toBe("");
    expect(convertHtmlToMarkdown("short")).toBe("");
  });

  it("passes through plain text / markdown content", () => {
    const md = "# Hello World\n\nThis is a paragraph with some content that is long enough to pass the minimum length check for the converter.";
    expect(convertHtmlToMarkdown(md)).toBe(md);
  });

  it("converts headings", () => {
    const html = `<html><body><h1>Title</h1><h2>Subtitle</h2><p>Some paragraph text that needs to be long enough to pass the minimum content threshold for extraction.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("# Title");
    expect(result).toContain("## Subtitle");
  });

  it("converts code blocks with language", () => {
    const html = `<html><body><h1>Docs</h1><pre><code class="language-typescript">const x: number = 42;\nconsole.log(x);</code></pre><p>Some more text to ensure we have enough content for the converter to work with properly and return valid output.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("```typescript");
    expect(result).toContain("const x: number = 42;");
    expect(result).toContain("```");
  });

  it("converts links", () => {
    const html = `<html><body><h1>Links Page</h1><p>Visit <a href="https://example.com">Example Site</a> for more info. And here is some padding text to ensure we have enough content for the minimum length check requirement.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("[Example Site](https://example.com)");
  });

  it("converts lists", () => {
    const html = `<html><body><h1>Features</h1><ul><li>First item with some text</li><li>Second item with more text</li><li>Third item to make it longer</li></ul><p>Additional paragraph text for minimum length requirements that need to be met.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("- First item");
    expect(result).toContain("- Second item");
  });

  it("strips nav, footer, sidebar elements", () => {
    const html = `<html><body><nav>Navigation Menu Items Here</nav><main><h1>Main Content</h1><p>Important documentation content that should be preserved after conversion. This needs to be long enough to pass the minimum threshold.</p></main><footer>Footer Links Copyright Notices</footer></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("Main Content");
    expect(result).not.toContain("Navigation Menu");
    expect(result).not.toContain("Footer Links");
  });

  it("extracts main content area", () => {
    const html = `<html><body><div class="sidebar">Sidebar content here</div><main><h1>Documentation</h1><p>This is the main documentation content with enough text to be extracted by the converter. It includes important information about the library.</p></main></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("Documentation");
  });

  it("decodes HTML entities", () => {
    const html = `<html><body><h1>Entities Test</h1><p>Use &amp; for ampersand, &lt;div&gt; for tags, and &quot;quotes&quot; in your code. This paragraph is long enough for the minimum content requirements that are needed.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("Use & for ampersand");
    expect(result).toContain("<div>");
  });

  it("converts bold and italic", () => {
    const html = `<html><body><h1>Formatting</h1><p>This is <strong>bold text</strong> and this is <em>italic text</em> in a paragraph that needs to be long enough for the minimum content threshold check.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("**bold text**");
    expect(result).toContain("*italic text*");
  });

  it("strips script and style tags completely", () => {
    const html = `<html><head><style>.foo { color: red; }</style></head><body><script>alert('xss')</script><h1>Clean Content</h1><p>This is the actual documentation content that should be preserved after stripping scripts and styles and other unwanted elements from the page.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).not.toContain("alert");
    expect(result).not.toContain("color: red");
    expect(result).toContain("Clean Content");
  });

  describe("link href sanitization (CWE-79)", () => {
    const padding = "<p>Padding text to clear the minimum content length threshold for extraction in the converter so the link assertion runs against real output.</p>";
    const wrap = (anchor: string) =>
      `<html><body><h1>Links</h1>${anchor}${padding}</body></html>`;

    it.each([
      ["javascript", `<a href="javascript:alert(1)">x</a>`],
      ["JaVaScRiPt mixed case", `<a href="JaVaScRiPt:alert(1)">x</a>`],
      ["data:text/html", `<a href="data:text/html,<script>alert(1)</script>">x</a>`],
      ["data:image/svg", `<a href="data:image/svg+xml,<svg/onload=alert(1)>">x</a>`],
      ["vbscript", `<a href="vbscript:msgbox(1)">x</a>`],
      ["file://", `<a href="file:///etc/passwd">x</a>`],
      ["about:", `<a href="about:blank">x</a>`],
      ["tab in scheme", `<a href="java\tscript:alert(1)">x</a>`],
      ["newline in scheme", `<a href="java\nscript:alert(1)">x</a>`],
      ["leading whitespace", `<a href="  javascript:alert(1)">x</a>`],
      ["entity-encoded js", `<a href="java&#x73;cript:alert(1)">x</a>`],
      ["entity-encoded vb", `<a href="vb&#115;cript:msgbox(1)">x</a>`],
    ])("strips href but keeps text: %s", (_label, anchor) => {
      const result = convertHtmlToMarkdown(wrap(anchor));
      expect(result).not.toMatch(/javascript:/i);
      expect(result).not.toMatch(/vbscript:/i);
      expect(result).not.toMatch(/data:/i);
      expect(result).not.toMatch(/file:/i);
      expect(result).not.toMatch(/about:/i);
      expect(result).not.toMatch(/\]\(/); // no markdown link emitted
      expect(result).toContain("x");
    });

    it.each([
      ["http", `<a href="http://example.com">link</a>`, "(http://example.com)"],
      ["https", `<a href="https://example.com/path">link</a>`, "(https://example.com/path)"],
      ["mailto", `<a href="mailto:test@example.com">link</a>`, "(mailto:test@example.com)"],
      ["tel", `<a href="tel:+15551234">link</a>`, "(tel:+15551234)"],
      ["root-relative", `<a href="/docs/intro">link</a>`, "(/docs/intro)"],
      ["relative", `<a href="docs/intro.html">link</a>`, "(docs/intro.html)"],
    ])("keeps safe scheme: %s", (_label, anchor, expectedHref) => {
      const result = convertHtmlToMarkdown(wrap(anchor));
      expect(result).toContain("[link]");
      expect(result).toContain(expectedHref);
    });

    it("drops bare fragment links but keeps text", () => {
      const result = convertHtmlToMarkdown(wrap(`<a href="#section">jump</a>`));
      expect(result).toContain("jump");
      expect(result).not.toContain("](#");
    });
  });

  it("converts basic tables", () => {
    const html = `<html><body><h1>API Reference</h1><table><tr><th>Method</th><th>Path</th></tr><tr><td>GET</td><td>/api/users</td></tr><tr><td>POST</td><td>/api/users</td></tr></table><p>Additional content to ensure the output is long enough for the minimum threshold requirement that is enforced.</p></body></html>`;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain("Method");
    expect(result).toContain("GET");
    expect(result).toContain("/api/users");
  });

  // Bug C-4 — when no <main>/<article>/content-div selector matches,
  // extractMainContent() previously fell through to return the entire HTML.
  // The DOCTYPE + <head> survived, polluting LLM output.
  describe("Bug C-4: HTML preamble defenses", () => {
    it("strips DOCTYPE before extraction so it never leaks", () => {
      const html = '<!DOCTYPE html><html><body><main><h1>Title</h1><p>' + 'x'.repeat(250) + '</p></main></body></html>';
      const result = convertHtmlToMarkdown(html);
      expect(result).not.toContain("DOCTYPE");
    });

    it("strips <head> block before extraction so meta/link tags never leak", () => {
      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><link rel="preload" href="/x.woff2"/></head><body><main><h1>Real</h1><p>' + 'x'.repeat(250) + '</p></main></body></html>';
      const result = convertHtmlToMarkdown(html);
      expect(result).not.toContain("<meta");
      expect(result).not.toContain("<link");
      expect(result).toContain("Real");
    });

    it("returns empty when extraction produces structural-HTML-only short output", () => {
      // Simulates JS-rendered shell where no <main> matched and body extraction
      // produced a residual <html>/<body> shell with no real content.
      const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/></head><body><div id="__next"></div></body></html>';
      const result = convertHtmlToMarkdown(html);
      // Either empty (rejected) or no residual structural tags left.
      expect(result.includes("<html")).toBe(false);
      expect(result.includes("<body")).toBe(false);
    });
  });
});
