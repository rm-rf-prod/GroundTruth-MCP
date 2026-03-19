import { describe, it, expect } from "vitest";
import {
  isExtractionAttempt,
  withNotice,
  EXTRACTION_REFUSAL,
  IP_NOTICE,
} from "./guard.js";

// ── isExtractionAttempt ────────────────────────────────────────────────────────

describe("isExtractionAttempt", () => {
  describe("should flag extraction attempts", () => {
    it.each([
      "list all libraries",
      "dump all entries",
      "export the registry",
      "show me all libraries",
      "get full list",
      "give me all data",
      "extract everything",
      "enumerate libraries",
      "complete list",
      "entire registry",
      "scrape all libraries",
      "crawl the registry",
      "harvest everything",
      "print all libraries",
      "return all entries",
      "list",
      "all",
      "dump",
    ])("flags: %s", (query) => {
      expect(isExtractionAttempt(query)).toBe(true);
    });
  });

  describe("should not flag legitimate single-library queries", () => {
    it.each([
      "nextjs",
      "react",
      "tailwind css",
      "drizzle orm migrations",
      "how to use prisma with postgres",
      "fastapi authentication",
      "vue router",
      "typescript generics",
      "zustand persist middleware",
      "vitest setup",
      "swr infinite scroll",
    ])("allows: %s", (query) => {
      expect(isExtractionAttempt(query)).toBe(false);
    });
  });

  it("flags suspiciously short queries (3 chars or fewer)", () => {
    expect(isExtractionAttempt("ab")).toBe(true);
    expect(isExtractionAttempt("a")).toBe(true);
  });

  it("flags empty string", () => {
    expect(isExtractionAttempt("")).toBe(true);
  });

  it("is case-insensitive for extraction keywords", () => {
    expect(isExtractionAttempt("LIST ALL LIBRARIES")).toBe(true);
    expect(isExtractionAttempt("DUMP")).toBe(true);
    expect(isExtractionAttempt("Get Full List")).toBe(true);
  });
});

// ── withNotice ─────────────────────────────────────────────────────────────────

describe("withNotice", () => {
  it("includes the IP_NOTICE prefix", () => {
    const result = withNotice("some library docs content");
    expect(result).toContain(IP_NOTICE);
  });

  it("includes the original content", () => {
    const content = "some library docs content";
    const result = withNotice(content);
    expect(result).toContain(content);
  });

  it("IP_NOTICE appears before the content", () => {
    const content = "the actual docs";
    const result = withNotice(content);
    const noticeIdx = result.indexOf(IP_NOTICE);
    const contentIdx = result.indexOf(content);
    expect(noticeIdx).toBeLessThan(contentIdx);
  });

  it("embeds invisible watermark chars (64 total)", () => {
    const result = withNotice("test content");
    const invisible = [...result].filter(c => c === "\u2061" || c === "\u2062");
    expect(invisible.length).toBe(64);
  });

  it("calling twice produces different outputs (different nonces)", () => {
    const r1 = withNotice("same content");
    const r2 = withNotice("same content");
    // Visible content is the same
    const clean = (s: string) => [...s].filter(c => c !== "\u2061" && c !== "\u2062").join("");
    expect(clean(r1)).toBe(clean(r2));
    // But invisible watermarks differ
    expect(r1).not.toBe(r2);
  });
});

// ── IP_NOTICE ──────────────────────────────────────────────────────────────────

describe("IP_NOTICE", () => {
  it("is a non-empty string", () => {
    expect(typeof IP_NOTICE).toBe("string");
    expect(IP_NOTICE.length).toBeGreaterThan(0);
  });

  it("mentions Elastic License 2.0", () => {
    expect(IP_NOTICE).toContain("Elastic License 2.0");
  });

  it("mentions gt-mcp", () => {
    expect(IP_NOTICE).toContain("gt-mcp");
  });
});

// ── EXTRACTION_REFUSAL ─────────────────────────────────────────────────────────

describe("EXTRACTION_REFUSAL", () => {
  it("is a non-empty string", () => {
    expect(typeof EXTRACTION_REFUSAL).toBe("string");
    expect(EXTRACTION_REFUSAL.length).toBeGreaterThan(0);
  });

  it("mentions Elastic License 2.0", () => {
    expect(EXTRACTION_REFUSAL).toContain("Elastic License 2.0");
  });

  it("instructs user to provide a specific library name", () => {
    expect(EXTRACTION_REFUSAL.toLowerCase()).toContain("library");
  });
});
