import { describe, it, expect } from "vitest";
import { extractRelevantContent, sliceVersionBand, parseMajor, tokenize, expandTopicTokens, substantiveTokens } from "./extract.js";

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

  it("closes an unclosed code fence when the char-limit cutoff lands inside it", () => {
    // The doc opens a ```bash fence and never closes it — the final resultText.slice(0,
    // charLimit) cutoff (extract.ts:366-371) must land mid-fence and auto-close it so the
    // client never receives an unbalanced ``` that swallows everything after it.
    const content = "# Guide\n\n```bash\n" + "echo line\n".repeat(2000);
    const { text, truncated } = extractRelevantContent(content, "guide", 50);
    expect(truncated).toBe(true);
    expect((text.match(/```/g) ?? []).length % 2).toBe(0);
    expect(text.trimEnd().endsWith("```")).toBe(true);
  });
});

// ── topic vocabulary helpers ────────────────────────────────────────────────

describe("expandTopicTokens", () => {
  it("bridges migration queries to upgrade-guide vocabulary", () => {
    const expanded = expandTopicTokens(["v4", "migration"]);
    expect(expanded).toContain("upgrade");
    expect(expanded).toContain("v4");
    expect(expanded).toContain("migration");
  });

  it("returns tokens unchanged when no synonyms exist", () => {
    expect(expandTopicTokens(["zustand"])).toEqual(["zustand"]);
  });
});

describe("substantiveTokens", () => {
  it("drops query-meta words so off-topic pages cannot pass on them", () => {
    expect(substantiveTokens("postgres row level security best practices")).toEqual([
      "postgres", "row", "level", "security",
    ]);
  });

  it("keeps meta words when the topic is nothing but meta words", () => {
    expect(substantiveTokens("best practices")).toEqual(["best", "practices"]);
  });
});
