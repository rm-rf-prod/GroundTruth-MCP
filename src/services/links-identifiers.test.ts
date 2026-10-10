import { describe, it, expect } from "vitest";
import { rankLinksForTopic, scoreTopicRelevance, hasTopicIdentifiers } from "./links.js";

const link = (path: string, text: string) => ({ url: `https://developers.cloudflare.com${path}`, text });

describe("rankLinksForTopic — topic identifiers (ACC-06)", () => {
  it("ranks the KV pages for 'KV namespace get put', which tokenize() reduces to 'namespace'", () => {
    const ranked = rankLinksForTopic(
      [
        link("/workers/wrangler/commands/artifacts/", "Artifacts"),
        link("/kv/api/", "KV"),
        link("/workers/wrangler/commands/kv/", "KV"),
        link("/workers/tutorials/workers-kv-from-rust/", "Use Workers KV directly from Rust"),
      ],
      "KV namespace get put",
    );
    expect(ranked.map((l) => l.url)).toEqual([
      "https://developers.cloudflare.com/kv/api/",
      "https://developers.cloudflare.com/workers/wrangler/commands/kv/",
      "https://developers.cloudflare.com/workers/tutorials/workers-kv-from-rust/",
    ]);
  });

  it("matches identifiers only at a word start", () => {
    const ranked = rankLinksForTopic([link("/workers/blkv/", "Blkv storage"), link("/kv/", "KV")], "KV");
    expect(ranked.map((l) => l.text)).toEqual(["KV"]);
  });

  it("matches dotted identifiers verbatim in link text", () => {
    const ranked = rankLinksForTopic(
      [
        { url: "https://vitest.dev/guide/mocking", text: "Mocking" },
        { url: "https://vitest.dev/api/vi", text: "vi.mock" },
      ],
      "vi.mock",
    );
    expect(ranked.map((l) => l.text)).toEqual(["vi.mock", "Mocking"]);
  });

  it("breaks the invalidateQueries tie with camelCase stems, without admitting new links", () => {
    const base = "https://tanstack.com/query/latest/docs";
    const ranked = rankLinksForTopic(
      [
        { url: "https://tanstack.com/router/latest/docs/guide/data-mutations", text: "Data Mutations" },
        { url: `${base}/eslint/mutation-property-order`, text: "Mutation property order" },
        { url: `${base}/framework/react/guides/mutations`, text: "Mutations" },
        { url: `${base}/framework/react/guides/invalidations-from-mutations`, text: "Invalidations from Mutations" },
        { url: `${base}/framework/react/guides/query-invalidation`, text: "Query Invalidation" },
      ],
      "invalidateQueries after mutation",
    );
    expect(ranked[0]?.text).toBe("Invalidations from Mutations");
    expect(ranked.at(-1)?.text).toBe("Data Mutations");
    expect(ranked.map((l) => l.text)).not.toContain("Query Invalidation");
  });
});

describe("scoreTopicRelevance — topic identifiers (ACC-06)", () => {
  it("counts an acronym tokenize() drops", () => {
    expect(scoreTopicRelevance("Workers KV stores key-value pairs.", "KV")).toBe(1);
    expect(scoreTopicRelevance("Durable Objects hold state.", "KV")).toBe(0);
  });

  it("does not count an acronym inside a word", () => {
    expect(scoreTopicRelevance("Use markvalue helpers.", "KV")).toBe(0);
  });

  it("lowers the score when an identifier is missing", () => {
    const page = "Module mocking: mock a module and its mocking helpers.";
    expect(scoreTopicRelevance(page, "vi.mock module mocking")).toBeLessThan(scoreTopicRelevance(`vi.mock(). ${page}`, "vi.mock module mocking"));
  });
});

describe("hasTopicIdentifiers (ACC-09)", () => {
  it("is true when the topic has no identifiers", () => {
    expect(hasTopicIdentifiers("anything", "row level security")).toBe(true);
  });

  it("needs every identifier as written, not its split words", () => {
    expect(hasTopicIdentifiers("Invalidate queries after a mutation.", "invalidateQueries after mutation")).toBe(false);
    expect(hasTopicIdentifiers("Call queryClient.invalidateQueries().", "invalidateQueries after mutation")).toBe(true);
  });

  it("ignores link targets but keeps link text", () => {
    expect(hasTopicIdentifiers("See [storage](https://x.dev/kv/).", "KV namespace")).toBe(false);
    expect(hasTopicIdentifiers("See [KV](https://x.dev/kv/).", "KV namespace")).toBe(true);
  });
});

describe("library names with a .js suffix", () => {
  // vuejs.org's reactivity guide says "Vue" throughout and never "Vue.js".
  const page = "Reactivity Fundamentals. Declaring reactive state: in Vue, use ref(). Vue's reactivity system tracks it.";

  it("does not fail the canonical page for 'Vue.js reactivity'", () => {
    expect(scoreTopicRelevance(page, "Vue.js reactivity")).toBeGreaterThanOrEqual(0.3);
    expect(hasTopicIdentifiers(page, "Vue.js reactivity")).toBe(true);
  });
});
