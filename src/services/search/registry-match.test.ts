import { describe, it, expect } from "vitest";
import { registryMatches } from "./registry-match.js";

describe("registryMatches", () => {
  it("finds the library in a 'library + topic' query and strips it from the topic", () => {
    expect(registryMatches("supabase row level security policies auth.uid")).toEqual([
      { id: "supabase/supabase", topic: "row level security policies auth.uid" },
    ]);
    expect(registryMatches("React hooks best practices")).toEqual([
      { id: "facebook/react", topic: "hooks best practices" },
    ]);
  });

  it("prefers a two-word name over a one-word one", () => {
    expect(registryMatches("tanstack query invalidateQueries")).toEqual([
      { id: "tanstack/query", topic: "invalidateQueries" },
    ]);
  });

  it("keeps the whole query as topic when the whole query names the library", () => {
    const [first] = registryMatches("supabase");
    expect(first).toEqual({ id: "supabase/supabase", topic: "supabase" });
  });

  it("ignores words that only partly match a library name", () => {
    expect(registryMatches("how to deploy a web app")).toEqual([]);
    expect(registryMatches("form validation patterns")).toEqual([]);
  });

  it("does not read an alias made of ordinary words as a library", () => {
    for (const q of [
      "rich text editor",
      "Rich text editor",
      "black box testing",
      "three column layout css",
      "modal dialog accessibility",
      "next steps for deployment",
      "spring animation physics",
      "effect cleanup function",
    ]) {
      expect(registryMatches(q), q).toEqual([]);
    }
  });

  it("skips an ordinary-word alias to reach the real library name", () => {
    expect(registryMatches("how does tracing work in opentelemetry")).toEqual([
      { id: "open-telemetry/opentelemetry-js", topic: "tracing work" },
    ]);
  });

  it("accepts an ordinary-word alias written as a name", () => {
    expect(registryMatches("progress bars in Rich")).toEqual([
      { id: "Textualize/rich", topic: "progress bars" },
    ]);
    expect(registryMatches("progress bars with `rich`")).toEqual([
      { id: "Textualize/rich", topic: "progress bars" },
    ]);
  });

  it("prefers the library over the language it is written in", () => {
    expect(registryMatches("rust tokio spawn a task")).toEqual([{ id: "tokio-rs/tokio", topic: "spawn task" }]);
  });

  it("still finds a library through the whole-query fuzzy match", () => {
    expect(registryMatches("css grid layout")[0]?.id).toBe("mdn/css-grid");
  });
});
