import { describe, it, expect } from "vitest";
import {
  LIBRARY_REGISTRY,
  lookupById,
  lookupByAlias,
  fuzzySearch,
} from "./registry.js";

describe("LIBRARY_REGISTRY", () => {
  it("has no duplicate IDs", () => {
    const ids = LIBRARY_REGISTRY.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every entry has a non-empty id, name, and docsUrl", () => {
    for (const entry of LIBRARY_REGISTRY) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.docsUrl.length).toBeGreaterThan(0);
    }
  });

  it("all docsUrls start with https://", () => {
    for (const entry of LIBRARY_REGISTRY) {
      expect(entry.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it("all githubUrls start with https://github.com/ when present", () => {
    for (const entry of LIBRARY_REGISTRY) {
      if (entry.githubUrl) {
        expect(entry.githubUrl).toMatch(/^https:\/\/github\.com\//);
      }
    }
  });

  it("all llmsTxtUrl values are HTTPS URLs when present", () => {
    for (const entry of LIBRARY_REGISTRY) {
      if (entry.llmsTxtUrl) {
        expect(entry.llmsTxtUrl, `${entry.id} llmsTxtUrl`).toMatch(/^https:\/\//);
      }
    }
  });

  it("all llmsFullTxtUrl values are HTTPS URLs when present", () => {
    for (const entry of LIBRARY_REGISTRY) {
      if (entry.llmsFullTxtUrl) {
        expect(entry.llmsFullTxtUrl, `${entry.id} llmsFullTxtUrl`).toMatch(/^https:\/\//);
      }
    }
  });

  it("all bestPracticesPaths start with / when present", () => {
    for (const entry of LIBRARY_REGISTRY) {
      if (entry.bestPracticesPaths) {
        for (const path of entry.bestPracticesPaths) {
          expect(path, `${entry.id} path: ${path}`).toMatch(/^\//);
        }
      }
    }
  });

  it("all urlPatterns contain {slug} when present", () => {
    for (const entry of LIBRARY_REGISTRY) {
      if (entry.urlPatterns) {
        for (const pattern of entry.urlPatterns) {
          expect(pattern, `${entry.id} pattern: ${pattern}`).toContain("{slug}");
        }
      }
    }
  });

  it("no duplicate aliases across different entries", () => {
    const aliasMap = new Map<string, string>();
    for (const entry of LIBRARY_REGISTRY) {
      for (const alias of entry.aliases) {
        const lower = alias.toLowerCase();
        const existing = aliasMap.get(lower);
        if (existing && existing !== entry.id) {
          expect.fail(`Duplicate alias "${alias}" shared by ${existing} and ${entry.id}`);
        }
        aliasMap.set(lower, entry.id);
      }
    }
  });

  it("every entry has bestPracticesPaths", () => {
    for (const entry of LIBRARY_REGISTRY) {
      expect(entry.bestPracticesPaths, `${entry.id} missing bestPracticesPaths`).toBeDefined();
      expect(entry.bestPracticesPaths!.length, `${entry.id} empty bestPracticesPaths`).toBeGreaterThan(0);
    }
  });

  it("every entry has urlPatterns", () => {
    for (const entry of LIBRARY_REGISTRY) {
      expect(entry.urlPatterns, `${entry.id} missing urlPatterns`).toBeDefined();
      expect(entry.urlPatterns!.length, `${entry.id} empty urlPatterns`).toBeGreaterThan(0);
    }
  });
});

describe("lookupById", () => {
  it("finds Next.js by exact id", () => {
    const entry = lookupById("vercel/next.js");
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("Next.js");
  });

  it("returns undefined for unknown id", () => {
    expect(lookupById("does/not-exist")).toBeUndefined();
  });

  it("is case-sensitive (ids are lowercase slugs)", () => {
    expect(lookupById("VERCEL/NEXT.JS")).toBeUndefined();
  });
});

describe("lookupByAlias", () => {
  it("finds React by lowercase alias 'react'", () => {
    const entry = lookupByAlias("react");
    expect(entry?.id).toBe("facebook/react");
  });

  it("finds Next.js by alias 'nextjs'", () => {
    const entry = lookupByAlias("nextjs");
    expect(entry?.name).toBe("Next.js");
  });

  it("finds Tailwind by alias 'tailwindcss'", () => {
    const entry = lookupByAlias("tailwindcss");
    expect(entry?.name).toBe("Tailwind CSS");
  });

  it("matches npmPackage field (e.g. 'next' for Next.js)", () => {
    const entry = lookupByAlias("next");
    expect(entry?.name).toBe("Next.js");
  });

  it("is case-insensitive", () => {
    const entry = lookupByAlias("REACT");
    expect(entry?.name).toBe("React");
  });

  it("returns undefined for unknown alias", () => {
    expect(lookupByAlias("absolutely-unknown-lib-xyz")).toBeUndefined();
  });
});

describe("fuzzySearch", () => {
  it("returns exact name match as first result", () => {
    const results = fuzzySearch("React");
    expect(results[0]?.name).toBe("React");
  });

  it("returns at most `limit` results", () => {
    const results = fuzzySearch("js", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns empty array for nonsense query", () => {
    const results = fuzzySearch("zzzzzzzzzzzzzzzzz");
    expect(results).toHaveLength(0);
  });

  it("finds Vue.js by partial name 'vue'", () => {
    const results = fuzzySearch("vue");
    const ids = results.map((e) => e.id);
    expect(ids).toContain("vuejs/vue");
  });

  it("default limit is 10", () => {
    const results = fuzzySearch("js");
    expect(results.length).toBeLessThanOrEqual(10);
  });
});
