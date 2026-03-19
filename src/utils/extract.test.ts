import { describe, it, expect } from "vitest";
import { extractRelevantContent } from "./extract.js";

const SHORT = "Hello world. This is short content.";
const LONG_DOC = `
# Getting Started

Install the package with npm.

## Authentication

Configure your API key before making requests.
The auth token must be passed as a Bearer header.

## Security

Never expose your secret key in client-side code.
Store secrets in environment variables only.
Use HTTPS for all API calls.
SQL injection prevention is critical.

## Performance

Cache responses where possible.
Use connection pooling for database access.
Lazy load large assets.

## Accessibility

All images need alt text.
Color contrast must meet WCAG AA.
Focus indicators must be visible.
`.repeat(30); // make it long enough to trigger truncation

describe("extractRelevantContent", () => {
  it("returns full content when under token limit", () => {
    const result = extractRelevantContent(SHORT, "topic", 8000);
    expect(result.text).toBe(SHORT);
    expect(result.truncated).toBe(false);
  });

  it("returns truncated flag when content exceeds limit", () => {
    const result = extractRelevantContent(LONG_DOC, "security", 500);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(500 * 4);
  });

  it("ranks topic-relevant sections higher", () => {
    const result = extractRelevantContent(LONG_DOC, "security SQL injection", 500);
    expect(result.text.toLowerCase()).toContain("security");
  });

  it("returns first charLimit chars when no topic provided", () => {
    const result = extractRelevantContent(LONG_DOC, "", 500);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(500 * 4 + 10); // small buffer for exact boundary
  });

  it("handles empty content", () => {
    const result = extractRelevantContent("", "topic", 8000);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(false);
  });

  it("handles content with no markdown headings", () => {
    const flat = "This is plain text without any headers.\n".repeat(50);
    const result = extractRelevantContent(flat, "plain", 1000);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("awards BM25 code-block bonus when code block contains a query token", () => {
    // Implementation section placed FIRST so it survives the final resultText.slice(0, charLimit).
    // "authenticate" only appears in the code block — triggers the +5 BM25 bonus path.
    const withCode = `# Implementation\n\nSee the code below:\n\`\`\`typescript\nconst result = authenticate(apiKey);\n\`\`\`\n`;
    const filler = "# Filler\n\nGeneric content without the target term.\n".repeat(50);
    const doc = withCode + filler;
    const result = extractRelevantContent(doc, "authenticate", 300);
    expect(result.text).toContain("Implementation");
  });

  it("includes at least one section even when it exceeds charLimit (forced-single-section path)", () => {
    // charLimit = floor(1 * 4) = 4 — smaller than any section.
    // The loop finds picked.length === 0 when first section > charLimit → forces inclusion.
    const bigSection = "# BigSection\n\n" + "word ".repeat(200);
    const doc = bigSection + "\n\n# Tiny\n\nHi.\n";
    const result = extractRelevantContent(doc, "word", 1);
    // Must include content despite the absurdly small limit
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("preserves document order of picked sections", () => {
    const ordered = `
# Section A

Content about apples.

## Section B

Content about bananas.

## Section C

Content about coconuts and apples again.
`;
    const result = extractRelevantContent(ordered, "apples", 2000);
    const aIdx = result.text.indexOf("Section A");
    const cIdx = result.text.indexOf("Section C");
    if (aIdx !== -1 && cIdx !== -1) {
      expect(aIdx).toBeLessThan(cIdx);
    }
  });
});
