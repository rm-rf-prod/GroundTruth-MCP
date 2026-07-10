import { describe, it, expect } from "vitest";
import { extractRelevantContent, sliceVersionBand, parseMajor, tokenize } from "./extract.js";

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

  it("awards BM25 code-block bonus when query token is in one of many code blocks (cap does not break bonus)", () => {
    // Build a section with 20 code blocks; the query token appears in block #3
    // (index 2), well within MAX_CODE_BLOCKS=10 cap. Bonus must still fire.
    const matchingBlock = "```typescript\nconst result = greptag(key);\n```";
    const plainBlock = "```typescript\nconst x = doSomethingElse();\n```";
    // 2 plain blocks before the match, then match, then 17 more plain blocks = 20 total
    const manyBlocks =
      plainBlock + "\n" +
      plainBlock + "\n" +
      matchingBlock + "\n" +
      Array(17).fill(plainBlock).join("\n");
    const withCode = `# Implementation\n\nSee multiple code examples:\n${manyBlocks}\n`;
    const filler = "# Filler\n\nGeneric content without the target term.\n".repeat(50);
    const doc = withCode + filler;
    const result = extractRelevantContent(doc, "greptag", 400);
    // The Implementation section must rank first — proving bonus was awarded
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

describe("sliceVersionBand", () => {
  it("keeps only the requested inclusive version band", () => {
    const doc = "## v14\nold withAmp stuff\n## v15\nnew app router\n## v16\nfuture cache";
    const out = sliceVersionBand(doc, "14", "15");
    expect(out).toContain("v14");
    expect(out).toContain("v15");
    expect(out).not.toContain("v16");
    expect(out).not.toContain("future cache");
  });

  it("excludes ancient sections for a forward migration (the gt_migration P0 bug)", () => {
    const doc = [
      "## Upgrading from version 10 to 11",
      "Remove withAmp and @zeit/next-typescript.",
      "## Version 15",
      "App Router stabilized.",
      "## Version 16",
      "Cache Components and async params.",
    ].join("\n");
    const out = sliceVersionBand(doc, "15", "16");
    expect(out).toContain("Version 16");
    expect(out).toContain("Cache Components");
    expect(out).not.toContain("withAmp");
    expect(out).not.toContain("version 10 to 11");
  });

  it("returns full content unchanged when neither bound is given", () => {
    const doc = "## v1\na\n## v2\nb";
    expect(sliceVersionBand(doc)).toBe(doc);
  });

  it("falls back to full content when no versioned heading matches the band", () => {
    const doc = "## Overview\nGeneral notes.\n## Setup\nInstall steps.";
    expect(sliceVersionBand(doc, "15", "16")).toBe(doc);
  });

  it("inherits include state for heading-less sub-sections", () => {
    const doc = "## v16\nmain\n### Details\nsub detail\n## v9\nancient";
    const out = sliceVersionBand(doc, "16", "16");
    expect(out).toContain("sub detail");
    expect(out).not.toContain("ancient");
  });
});

describe("parseMajor", () => {
  it.each([
    ["15", 15],
    ["v15.2.0", 15],
    ["v3", 3],
    ["16.0.0", 16],
  ])("parses %s -> %i", (input, expected) => {
    expect(parseMajor(input as string)).toBe(expected);
  });

  it("returns undefined for missing, non-numeric, or year-like values", () => {
    expect(parseMajor(undefined)).toBeUndefined();
    expect(parseMajor("latest")).toBeUndefined();
    expect(parseMajor("2026")).toBeUndefined();
  });
});

describe("tokenize version tokens", () => {
  it("keeps short version tokens that would otherwise be dropped", () => {
    expect(tokenize("migration v15 v16")).toEqual(["migration", "v15", "v16"]);
  });

  it("keeps a bare numeric version", () => {
    expect(tokenize("upgrade to 16")).toContain("16");
  });
});

// ── fence-aware section parsing ─────────────────────────────────────────────

describe("extractRelevantContent fence handling", () => {
  it("keeps code fences intact when # comment lines appear inside them", () => {
    const content = [
      "# Guide",
      "",
      "```bash",
      "npm install foo",
      "# caching setup",
      "FOO_CACHING=1 npm start",
      "```",
      "",
      `${"unrelated prose. ".repeat(300)}`,
    ].join("\n");
    const { text } = extractRelevantContent(content, "caching", 1000);
    // A '# comment' inside a fence must not become a section boundary — that
    // splits the code block and ships unbalanced fences to the client.
    expect(((text.match(/```/g) ?? []).length) % 2).toBe(0);
    expect(text).toContain("npm install foo");
    expect(text).toContain("FOO_CACHING=1 npm start");
  });
});
