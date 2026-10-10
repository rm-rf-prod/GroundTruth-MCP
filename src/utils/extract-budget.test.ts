import { describe, it, expect } from "vitest";
import { extractRelevantContent } from "./extract.js";

const section = (heading: string, body: string): string => `## ${heading}\n\n${body}\n`;
const filler = (word: string): string => `${word} paragraph text goes here. `.repeat(12);

describe("extractRelevantContent — budget use", () => {
  it("does not pad the budget with sections that never mention the topic", () => {
    const doc = [
      section("Webhooks", "Webhooks deliver events. Verify each webhook signature. " + filler("webhook")),
      section("Billing", filler("billing")),
      section("Customers", filler("customer")),
      section("Invoices", filler("invoice")),
    ].join("\n");
    const { text, truncated } = extractRelevantContent(doc, "webhooks", 400);
    expect(doc.length).toBeGreaterThan(400 * 3.8);
    expect(text).toContain("Webhooks");
    expect(text).not.toContain("Billing");
    expect(text).not.toContain("Customers");
    expect(truncated).toBe(false);
  });

  it("matches sections through topic synonyms (caching -> cache)", () => {
    const doc = [
      section("Caching overview", "Caching keeps results around. " + filler("caching")),
      section("revalidateTag", "Purge cache entries by tag on demand. " + filler("purge")),
      section("Authentication", filler("login")),
    ].join("\n");
    const { text } = extractRelevantContent(doc, "caching", 300);
    expect(doc.length).toBeGreaterThan(300 * 3.8);
    expect(text).toContain("revalidateTag");
    expect(text).not.toContain("Authentication");
  });

  it("flags truncated only when a relevant section did not fit", () => {
    const relevant = (n: number): string => section(`Hooks part ${n}`, filler("hooks"));
    const doc = [relevant(1), relevant(2), relevant(3), relevant(4)].join("\n");
    const { truncated } = extractRelevantContent(doc, "hooks", 200);
    expect(truncated).toBe(true);
  });

  it("keeps the top section even when nothing matches the topic", () => {
    const doc = [section("Intro", filler("intro")), section("Setup", filler("setup"))].join("\n");
    const { text } = extractRelevantContent(doc, "graphql", 100);
    expect(text.length).toBeGreaterThan(0);
  });
});
