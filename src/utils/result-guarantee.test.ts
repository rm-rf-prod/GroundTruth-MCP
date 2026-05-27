import { describe, it, expect } from "vitest";
import { buildFallbackResponse, guaranteeText } from "./result-guarantee.js";

describe("result-guarantee", () => {
  describe("buildFallbackResponse", () => {
    it("produces text with displayName + 'what to do next' section", () => {
      const text = buildFallbackResponse({ displayName: "FakeLib" });
      expect(text).toContain("FakeLib");
      expect(text).toContain("What to do next");
      expect(text).toContain("gt_resolve_library");
    });

    it("includes attempted sources when provided", () => {
      const text = buildFallbackResponse({
        displayName: "FakeLib",
        attemptedSources: ["https://example.com/docs", "https://example.com/llms.txt"],
      });
      expect(text).toContain("Sources attempted");
      expect(text).toContain("https://example.com/docs");
    });

    it("uses custom suggestions when provided", () => {
      const text = buildFallbackResponse({
        displayName: "FakeLib",
        suggestions: ["Use custom suggestion A", "Try custom suggestion B"],
      });
      expect(text).toContain("custom suggestion A");
      expect(text).toContain("custom suggestion B");
      expect(text).not.toContain("gt_resolve_library");
    });

    it("includes IP notice header (via withNotice)", () => {
      const text = buildFallbackResponse({ displayName: "FakeLib" });
      expect(text).toContain("Elastic License 2.0");
    });
  });

  describe("guaranteeText", () => {
    it("returns the candidate text when valid", () => {
      const candidate =
        "This is a real content blob with enough information to be useful and pass the minimum length threshold.";
      const result = guaranteeText(candidate, { displayName: "X" });
      expect(result).toBe(candidate);
    });

    it("returns fallback when candidate is empty", () => {
      const result = guaranteeText("", { displayName: "X" });
      expect(result).toContain("What to do next");
    });

    it("returns fallback when candidate is too short", () => {
      const result = guaranteeText("too short", { displayName: "X" });
      expect(result).toContain("What to do next");
    });

    it("returns fallback when candidate is null/undefined", () => {
      const fromNull = guaranteeText(null, { displayName: "X" });
      const fromUndef = guaranteeText(undefined, { displayName: "X" });
      expect(fromNull).toContain("What to do next");
      expect(fromUndef).toContain("What to do next");
    });

    it("respects custom min length", () => {
      const candidate = "x".repeat(50);
      const result = guaranteeText(candidate, { displayName: "X" }, 100);
      expect(result).not.toBe(candidate);
      expect(result).toContain("What to do next");
    });
  });
});
