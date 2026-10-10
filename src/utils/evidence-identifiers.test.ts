import { describe, it, expect } from "vitest";
import { checkEvidence } from "./evidence.js";

describe("checkEvidence — identifier topics", () => {
  it("passes a camelCase topic on a page that uses the identifier", () => {
    const r = checkEvidence("## useEffect\n\nuseEffect lets you sync. Call useEffect at the top level.", "useEffect");
    expect(r.ok).toBe(true);
    expect(r.matchRatio).toBe(1);
    expect(r.missingTokens).toEqual([]);
  });

  it("fails a page that covers the plain words but never names the identifier", () => {
    // TanStack Router page served for a TanStack Query question.
    const page = [
      "## Data mutations",
      "After a mutation, invalidate the router so loaders run again.",
      "Invalidate queries by calling router.invalidate() after the mutation settles.",
    ].join("\n");
    const r = checkEvidence(page, "invalidateQueries after mutation");
    expect(r.ok).toBe(false);
    expect(r.missingTokens).toContain("invalidatequeries");
  });

  it("passes when the identifier appears verbatim, even inside code", () => {
    const page = "## Mutations\n\nAfter a mutation succeeds:\n\n```ts\nqueryClient.invalidateQueries({ queryKey: ['todos'] })\n```\n";
    expect(checkEvidence(page, "invalidateQueries after mutation").ok).toBe(true);
  });

  it("does not count an identifier that only appears in a source header line", () => {
    const page = [
      "## Source: https://example.com/guide/auth.uid",
      "> Source: deep-fetch — auth.uid docs",
      "## Row level security",
      "Policies restrict rows. Enable row level security on every table. Security policies use roles.",
    ].join("\n");
    const r = checkEvidence(page, "row level security policies auth.uid");
    expect(r.ok).toBe(false);
    expect(r.missingTokens).toContain("auth.uid");
  });

  it("checks short acronyms the tokenizer drops", () => {
    const kv = "## KV namespace\n\nBind a KV namespace, then call env.MY_KV.get(key). Namespace bindings are typed.";
    const r = checkEvidence(kv, "KV namespace get put");
    expect(r.ok).toBe(true);
    expect(r.matchedTokens).toContain("kv");

    const r2 = checkEvidence("## Namespace\n\nA namespace groups durable objects. Namespace ids are stable.", "KV namespace get put");
    expect(r2.ok).toBe(false);
    expect(r2.missingTokens).toEqual(["kv"]);
  });

  it("leaves plain-word topics unchanged", () => {
    const content = "## Logging\n\nLogging setup. Configure logging levels.";
    const r = checkEvidence(content, "logging");
    expect(r.ok).toBe(true);
    expect(r.matchedTokens).toEqual(["logging"]);
  });
});
