import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { directToMarkdown } from "./markdown.js";

const html = (body: string) => ({ text: `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`, contentType: "text/html" });
const prose = "<p>Documentation prose that explains how the option behaves in practice.</p>".repeat(4);

describe("directToMarkdown floor", () => {
  it("rejects a conversion that is tiny next to the page's visible text", () => {
    const sidebar = `<nav>${"<a href='/x'>Some navigation entry</a> ".repeat(500)}</nav>`;
    expect(directToMarkdown(html(`${sidebar}<main>${prose}</main>`))).toBeNull();
  });

  it("accepts the same content when it is most of the page", () => {
    const md = directToMarkdown(html(`<nav><a href="/x">Home</a></nav><main>${prose}</main>`));
    expect(md).toContain("Documentation prose");
  });

  it("returns the full tailwindcss.com install guide, not its 201-char lead", () => {
    const text = readFileSync(new URL("../../utils/__fixtures__/tailwind-install.html", import.meta.url), "utf8");
    const md = directToMarkdown({ text, contentType: "text/html; charset=utf-8" });
    expect(md).toContain("Start using Tailwind in your HTML");
    expect(md!.length).toBeGreaterThan(2_000);
  });
});
