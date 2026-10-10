import { describe, it, expect } from "vitest";
import { rankIndexLinks } from "./llms-index.js";

const INDEX = [
  "# Workers",
  "- [Artifacts](https://developers.cloudflare.com/workers/wrangler/commands/artifacts/index.md): Manage Artifacts namespaces.",
  "- [Bundling](https://developers.cloudflare.com/workers/wrangler/bundling/index.md): Review default bundling.",
  "- [KV](https://developers.cloudflare.com/kv/api/index.md): Global, low-latency, key-value data storage.",
  "- [Blkv](https://developers.cloudflare.com/workers/blkv/index.md): Not a KV page.",
  "- [KV](https://developers.cloudflare.com/workers/wrangler/commands/kv/index.md): Manage Workers KV namespaces.",
].join("\n");

describe("rankIndexLinks — topic identifiers (ACC-06)", () => {
  it("finds the KV links for 'KV namespace get put', which tokenize() reduces to 'namespace'", () => {
    expect(rankIndexLinks(INDEX, "KV namespace get put")).toEqual([
      "https://developers.cloudflare.com/kv/api/index.md",
      "https://developers.cloudflare.com/workers/wrangler/commands/kv/index.md",
    ]);
  });

  it("puts the invalidations guide first for 'invalidateQueries after mutation'", () => {
    const index = [
      "- [Mutation property order](https://tanstack.com/query/latest/docs/eslint/mutation-property-order.md)",
      "- [Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations.md)",
      "- [Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations.md)",
    ].join("\n");
    expect(rankIndexLinks(index, "invalidateQueries after mutation")[0]).toBe(
      "https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations.md",
    );
  });

  it("does not rank a link up for naming the library ('Next.js server actions')", () => {
    const index = [
      "- [Next.js MCP Server](https://nextjs.org/docs/app/guides/mcp): Learn how to give coding agents access to your running Next.js app.",
      "- [Server Actions](https://nextjs.org/docs/app/guides/server-actions): How Server Actions work in Next.js.",
    ].join("\n");
    expect(rankIndexLinks(index, "Next.js server actions")[0]).toBe("https://nextjs.org/docs/app/guides/server-actions");
  });
});

const TANSTACK = ["react", "solid", "vue", "angular", "preact"].flatMap((fw) => {
  const name = fw[0]!.toUpperCase() + fw.slice(1);
  return [
    `- [${name}: Query Invalidation](https://tanstack.com/query/latest/docs/framework/${fw}/guides/query-invalidation.md)`,
    `- [${name}: Invalidation from Mutations](https://tanstack.com/query/latest/docs/framework/${fw}/guides/invalidations-from-mutations.md)`,
    `- [${name}: Mutations](https://tanstack.com/query/latest/docs/framework/${fw}/guides/mutations.md)`,
  ];
}).join("\n");

describe("rankIndexLinks — framework copies of one guide", () => {
  it("fills its slots with distinct guides, not the same guide per framework", () => {
    const ranked = rankIndexLinks(TANSTACK, "invalidateQueries after mutation");
    expect(ranked).toEqual([
      "https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations.md",
      "https://tanstack.com/query/latest/docs/framework/react/guides/mutations.md",
    ]);
  });

  it("does not fill the freed slots with links that only share the library's URL path", () => {
    const index = [
      "- [Docs index](https://tanstack.com/query/latest/docs/index.md)",
      "- [Library home](https://tanstack.com/query/latest)",
      TANSTACK,
      ...["caching", "prefetching", "pagination", "testing"].map((g) => `- [React: ${g}](https://tanstack.com/query/latest/docs/framework/react/guides/${g}.md)`),
    ].join("\n");
    expect(rankIndexLinks(index, "query invalidation")).toEqual([
      "https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation.md",
      "https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations.md",
    ]);
  });

  it("takes the copy for the framework the docs URL names", () => {
    const ranked = rankIndexLinks(TANSTACK, "query invalidation", undefined, "https://tanstack.com/query/latest/docs/framework/vue/overview");
    expect(ranked[0]).toBe("https://tanstack.com/query/latest/docs/framework/vue/guides/query-invalidation.md");
    expect(ranked.every((u) => u.includes("/framework/vue/"))).toBe(true);
  });
});

describe("rankIndexLinks — an identifier no link names", () => {
  const VUE = [
    "- [Reactivity Fundamentals](/guide/essentials/reactivity-fundamentals.md)",
    "- [Computed Properties](/guide/essentials/computed.md)",
    "- [Watchers](/guide/essentials/watchers.md)",
    "- [Template Refs](/guide/essentials/template-refs.md)",
    "- [Lifecycle Hooks](/guide/essentials/lifecycle.md)",
  ].join("\n");

  it("falls back to the identifier's words: watchEffect finds Watchers", () => {
    expect(rankIndexLinks(VUE, "watchEffect", "https://vuejs.org/llms.txt")).toEqual(["https://vuejs.org/guide/essentials/watchers.md"]);
  });

  it("still returns nothing when no link shares a word either", () => {
    expect(rankIndexLinks(VUE, "defineModel", "https://vuejs.org/llms.txt")).toEqual([]);
  });
});

describe("rankIndexLinks — distinct pages stay distinct", () => {
  it("keeps index.md pages of different products", () => {
    const index = [
      "- [KV](https://developers.cloudflare.com/kv/index.md): Key-value storage.",
      "- [KV bindings](https://developers.cloudflare.com/d1/index.md): KV-style bindings for D1.",
      "- [Workers KV](https://developers.cloudflare.com/workers/kv/index.md): Workers KV namespaces.",
    ].join("\n");
    expect(rankIndexLinks(index, "KV")).toHaveLength(3);
  });
});
