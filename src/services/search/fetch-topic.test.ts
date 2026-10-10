import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, unknown>();
vi.mock("../cache.js", () => ({
  docCache: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, v) },
}));
vi.mock("../fetcher.js", () => ({
  fetchAsMarkdownRace: vi.fn(),
  isErrorPage: vi.fn(() => false),
  hashContent: (s: string) => s,
}));
vi.mock("./engines.js", () => ({ webSearch: vi.fn(async () => []) }));

import { fetchAsMarkdownRace } from "../fetcher.js";
import { webSearch } from "./engines.js";
import { fetchTopicContent, fetchAll, addWebSearchSources, type SearchSource } from "./fetch-topic.js";

// MDN's aria-level page matches "row" and "level" from a Postgres RLS query.
const ariaLevel = "# ARIA: aria-level attribute\n\n" +
  "The aria-level attribute defines the hierarchical level of an element. Each row has a level. ".repeat(8);
const QUERY = "postgres row level security";

beforeEach(() => {
  store.clear();
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(ariaLevel);
});

describe("fetchTopicContent — minimum coverage", () => {
  it("accepts a half-matching page at the default bar", async () => {
    expect(await fetchTopicContent("https://mdn/aria-level", QUERY, 2000)).not.toBe("");
  });

  it("drops a half-matching page when the caller asks for 75% coverage", async () => {
    expect(await fetchTopicContent("https://mdn/aria-level", QUERY, 2000, 0.75)).toBe("");
  });

  it("applies the stricter bar to cached text too", async () => {
    await fetchTopicContent("https://mdn/aria-level", QUERY, 2000);
    expect(await fetchTopicContent("https://mdn/aria-level", QUERY, 2000, 0.75)).toBe("");
  });
});

describe("fetchAll — slow losers", () => {
  it("returns the pages that landed within the grace window", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) =>
        url.includes("slow") ? new Promise<string>((r) => setTimeout(() => r(ariaLevel), 25_000)) : ariaLevel,
      );
      const pending = fetchAll(
        [{ url: "https://mdn/slow", source: "slow" }, { url: "https://mdn/aria-level", source: "MDN" }],
        QUERY,
        2000,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      const got = await Promise.race([pending, Promise.resolve("still waiting")]);
      expect(got).toEqual([expect.objectContaining({ url: "https://mdn/aria-level", source: "MDN" })]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("addWebSearchSources — slow losers", () => {
  it("adds the pages that landed within the grace window", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(webSearch).mockResolvedValueOnce(["https://slow.example/rls", "https://fast.example/rls"]);
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) =>
        url.includes("slow") ? new Promise<string>((r) => setTimeout(() => r(ariaLevel), 25_000)) : ariaLevel,
      );
      const results: SearchSource[] = [];
      let done = false;
      void addWebSearchSources(QUERY, results, 2000, 3).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done).toBe(true);
      expect(results).toEqual([expect.objectContaining({ url: "https://fast.example/rls", source: "fast.example" })]);
    } finally {
      vi.useRealTimers();
    }
  });
});
