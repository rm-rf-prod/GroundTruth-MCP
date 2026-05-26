import { describe, it, expect } from "vitest";
import { extractSnippets, rankSnippets, renderSnippets } from "./snippet-extract.js";

const SAMPLE_DOC = `# React Server Components

React Server Components let you write components that run on the server only.

## Basic Example

A simple server component fetches data:

\`\`\`tsx
async function ProductList() {
  const products = await db.products.findMany();
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}
\`\`\`

## Middleware

Add authentication middleware:

\`\`\`ts
import { auth } from "@/lib/auth";
export async function middleware(request) {
  const session = await auth();
  if (!session) return Response.redirect("/login");
}
\`\`\`

Short code below the cutoff:

\`\`\`js
x=1
\`\`\`
`;

describe("extractSnippets", () => {
  it("returns empty for short input", () => {
    expect(extractSnippets("", "react", "url")).toEqual([]);
    expect(extractSnippets("hi", "react", "url")).toEqual([]);
  });

  it("extracts fenced code blocks with title from heading", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "https://react.dev/docs", "19");
    expect(snippets.length).toBe(2);
    const titles = snippets.map((s) => s.title);
    expect(titles).toContain("Basic Example");
    expect(titles).toContain("Middleware");
  });

  it("normalises tsx and ts language tags", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url", "19");
    expect(snippets.find((s) => s.title === "Basic Example")?.language).toBe("typescript");
    expect(snippets.find((s) => s.title === "Middleware")?.language).toBe("typescript");
  });

  it("captures prose preceding the code block as description", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url", "19");
    const example = snippets.find((s) => s.title === "Basic Example");
    expect(example?.description).toContain("simple server component fetches data");
  });

  it("attaches version + library + source to each snippet", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "https://react.dev/docs", "19");
    for (const s of snippets) {
      expect(s.library).toBe("react");
      expect(s.version).toBe("19");
      expect(s.source).toBe("https://react.dev/docs");
      expect(s.id).toHaveLength(16);
    }
  });

  it("drops code blocks below MIN_CODE_LENGTH", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url");
    expect(snippets.find((s) => s.code.includes("x=1"))).toBeUndefined();
  });

  it("dedupes by title + code prefix", () => {
    const doubled = SAMPLE_DOC + "\n\n" + SAMPLE_DOC;
    const snippets = extractSnippets(doubled, "react", "url");
    expect(snippets.length).toBe(2);
  });
});

describe("rankSnippets", () => {
  it("returns all when topic empty", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url");
    const ranked = rankSnippets(snippets, "");
    expect(ranked.length).toBe(snippets.length);
  });

  it("ranks topic matches in titles highest", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url");
    const ranked = rankSnippets(snippets, "middleware authentication");
    expect(ranked[0]?.title).toBe("Middleware");
  });

  it("filters by language when set", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url");
    const tsOnly = rankSnippets(snippets, "", "typescript");
    expect(tsOnly.every((s) => s.language === "typescript")).toBe(true);
  });

  it("returns empty when topic has no matches and topic non-empty", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url");
    const ranked = rankSnippets(snippets, "zzzzzzz_no_match");
    expect(ranked).toEqual([]);
  });

  it("respects max parameter", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "url");
    const ranked = rankSnippets(snippets, "", undefined, 1);
    expect(ranked.length).toBe(1);
  });
});

describe("renderSnippets", () => {
  it("returns helpful message when empty", () => {
    expect(renderSnippets([])).toContain("No matching snippets");
  });

  it("renders title, description, language, code, source", () => {
    const snippets = extractSnippets(SAMPLE_DOC, "react", "https://react.dev/docs", "19");
    const out = renderSnippets(snippets);
    expect(out).toContain("### Basic Example");
    expect(out).toContain("Language: `typescript`");
    expect(out).toContain("```typescript");
    expect(out).toContain("https://react.dev/docs");
  });
});
