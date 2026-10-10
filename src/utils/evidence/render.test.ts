import { describe, it, expect } from "vitest";
import { buildEvidenceBlock } from "./render.js";

// The server instructions already say answers come from official sources, not
// training data; the footer only needs the date.
describe("buildEvidenceBlock footer", () => {
  it("states the fetch date without the per-response boilerplate", () => {
    const block = buildEvidenceBlock({ sources: [{ url: "https://example.com/docs" }] });
    const day = new Date().toISOString().slice(0, 10);
    expect(block).toContain(`- Fetched live ${day}\n`);
    expect(block).not.toContain("not from model training data");
    expect(block).toContain("- Source: https://example.com/docs");
  });
});
