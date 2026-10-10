import { describe, it, expect } from "vitest";
import { renderDocs, type DocsReportInput } from "./docs-report.js";
import { checkEvidence } from "../utils/evidence.js";

const input = (text: string, topic: string, truncated = false): DocsReportInput => ({
  libraryId: "cloudflare/workers",
  displayName: "Cloudflare Workers",
  topic,
  version: undefined,
  text,
  safe: text,
  truncated,
  fetchResult: { content: text, url: "https://developers.cloudflare.com/workers/llms.txt", sourceType: "llms-txt" },
  evidence: checkEvidence(text, topic),
  escalated: true,
  sourcesTried: [{ url: "https://developers.cloudflare.com/workers/llms.txt" }],
});

const page = "## Bindings\n\nBindings connect a Worker to resources. Each binding is typed. Bindings are declared in config.";

describe("renderDocs", () => {
  it("separates the header from the first heading", () => {
    const out = renderDocs(input(page, "bindings")).response.content[0]!.text;
    expect(out).toContain("---\n\n## Bindings");
  });

  it("asks for a narrower topic, not a bigger budget, when content was left out", () => {
    const out = renderDocs(input(page, "bindings", true)).response.content[0]!.text;
    expect(out).toContain("More matching sections were truncated; narrow the topic.");
    expect(out).not.toContain("increase tokens");
  });

  it("returns the topic-matched links of an index, not the whole index", () => {
    const unrelated = Array.from({ length: 40 }, (_, i) =>
      `- [Durable Objects guide ${i}](https://developers.cloudflare.com/durable-objects/guide-${i}/): Coordinate state.`);
    const index = [
      ...unrelated.slice(0, 20),
      "- [KV namespaces](https://developers.cloudflare.com/kv/concepts/kv-namespaces/): Create a KV namespace.",
      "- [Namespace methods](/kv/api/read-key-value-pairs/): Use get() on a KV binding.",
      ...unrelated.slice(20),
    ].join("\n");
    const res = renderDocs(input(index, "KV namespace get put"));
    const out = res.response.content[0]!.text;
    expect(out).toContain("- [KV namespaces](https://developers.cloudflare.com/kv/concepts/kv-namespaces/)");
    expect(out).toContain("- [Namespace methods](https://developers.cloudflare.com/kv/api/read-key-value-pairs/)");
    expect(out).not.toContain("Durable Objects guide");
    expect(res.response.structuredContent["content"]).not.toContain("Durable Objects guide");
  });

  it("names a missing identifier instead of calling a well-covered page sparse", () => {
    const routerPage = "## Data mutations\n\nAfter a mutation, invalidate the router. ".repeat(20);
    const out = renderDocs(input(routerPage, "invalidateQueries after mutation")).response.content[0]!.text;
    expect(out).toContain("> Evidence: Weak — not found in source: invalidatequeries.");
    expect(out).not.toContain("appear only sparsely");
  });
});
