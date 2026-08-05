import { describe, expect, it } from "vitest";
import { docsBaseSegment, joinDocPath, joinDocPaths } from "./url-join.js";

describe("docsBaseSegment", () => {
  it("returns the first path segment", () => {
    expect(docsBaseSegment("https://supabase.com/docs")).toBe("docs");
    expect(docsBaseSegment("https://docs.swmansion.com/react-native-screens/docs")).toBe("react-native-screens");
  });

  it("returns empty string at the origin root", () => {
    expect(docsBaseSegment("https://helmetjs.github.io/")).toBe("");
  });

  it("returns empty string for a malformed URL", () => {
    expect(docsBaseSegment("not a url")).toBe("");
  });
});

describe("joinDocPath", () => {
  it("passes absolute URLs through untouched", () => {
    expect(joinDocPath("https://x.dev/docs", "https://other.dev/a")).toEqual(["https://other.dev/a"]);
  });

  it("returns one URL when the docs live at the origin root", () => {
    expect(joinDocPath("https://helmetjs.github.io/", "/faq")).toEqual(["https://helmetjs.github.io/faq"]);
  });

  it("returns one URL when the path already carries the base segment", () => {
    expect(joinDocPath("https://vitejs.dev/guide", "/guide/features")).toEqual([
      "https://vitejs.dev/guide/features",
    ]);
  });

  it("keeps a project-slug base segment first — the origin-joined form 404s there", () => {
    expect(joinDocPath("https://docs.swmansion.com/react-native-screens/docs", "/docs/getting-started")).toEqual([
      "https://docs.swmansion.com/react-native-screens/docs/getting-started",
      "https://docs.swmansion.com/docs/getting-started",
    ]);
  });

  it("keeps historical origin-first order for generic section bases", () => {
    expect(joinDocPath("https://example.com/docs", "/api/hooks")).toEqual([
      "https://example.com/api/hooks",
      "https://example.com/docs/api/hooks",
    ]);
  });

  it("still offers the base-joined rescue for generic bases (supabase.com/docs + /guides)", () => {
    expect(joinDocPath("https://supabase.com/docs", "/guides/auth")).toContain(
      "https://supabase.com/docs/guides/auth",
    );
  });

  it("normalises a path given without a leading slash", () => {
    expect(joinDocPath("https://helmetjs.github.io/", "faq")).toEqual(["https://helmetjs.github.io/faq"]);
  });

  it("returns nothing for a malformed docs URL", () => {
    expect(joinDocPath("not a url", "/a")).toEqual([]);
  });
});

describe("joinDocPaths", () => {
  it("preserves order and drops duplicates", () => {
    const urls = joinDocPaths("https://example.com/docs", ["/api/a", "/api/a", "/docs/api/a"]);
    expect(urls).toEqual(["https://example.com/api/a", "https://example.com/docs/api/a"]);
  });
});
