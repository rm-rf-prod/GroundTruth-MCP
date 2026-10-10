import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRace } = vi.hoisted(() => ({ mockRace: vi.fn<(url: string) => Promise<string | null>>() }));

vi.mock("./fetcher.js", () => ({
  fetchAsMarkdownRace: mockRace,
  isIndexContent: () => false,
  rankIndexLinks: () => [],
  fetchSitemapUrls: async () => [],
}));
vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));
// The sidebar-link step reads the raw page; unit tests stay off the network.
vi.mock("./http/try-fetch.js", () => ({ tryFetch: async () => null }));

import { deepFetchForTopic, fetchMultiplePages } from "./deep-fetch.js";
import type { FetchResult } from "../types.js";

const PAGE = "Theme variables are defined with the @theme directive. ".repeat(10);
const after = (ms: number, value: string | null): Promise<string | null> =>
  new Promise((r) => setTimeout(() => r(value), ms));

beforeEach(() => {
  mockRace.mockReset();
  mockRace.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deepFetchForTopic discovery order (ACC-02)", () => {
  it("follows real internal links before guessing slug URLs", async () => {
    const initial: FetchResult = {
      content: "Intro page. See [Theme](https://tailwindcss.com/docs/theme) for details.",
      url: "https://tailwindcss.com/docs",
      sourceType: "direct",
    };
    mockRace.mockResolvedValue(PAGE);
    const result = await deepFetchForTopic(initial, "theme variables", "https://tailwindcss.com/docs");
    expect(result.url).toBe("https://tailwindcss.com/docs/theme");
    expect(mockRace.mock.calls.map(([u]) => u)).toEqual(["https://tailwindcss.com/docs/theme"]);
  });
});

describe("deepFetchForTopic timeout timer", () => {
  it("leaves no pending timer once it returns, so a one-shot process can exit", async () => {
    vi.useFakeTimers();
    const initial: FetchResult = { content: "unrelated", url: "https://docs.example.com", sourceType: "direct" };
    await deepFetchForTopic(initial, "caching", "https://docs.example.com");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("fetchMultiplePages settles on first hit plus a grace window (NET-03)", () => {
  it("does not wait for a slow straggler", async () => {
    vi.useFakeTimers();
    mockRace.mockImplementation((url) => (url.endsWith("/fast") ? after(10, PAGE) : after(20_000, PAGE)));
    let pages: Array<{ url: string }> | undefined;
    void fetchMultiplePages(["https://d.example.com/slow", "https://d.example.com/fast"], 8).then((p) => { pages = p; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pages?.map((p) => p.url)).toEqual(["https://d.example.com/fast"]);
    await vi.advanceTimersByTimeAsync(20_000);
  });

  it("keeps ranked order for pages that arrive within the window", async () => {
    vi.useFakeTimers();
    mockRace.mockImplementation((url) => (url.endsWith("/first") ? after(300, PAGE) : after(10, PAGE)));
    const pending = fetchMultiplePages(["https://d.example.com/first", "https://d.example.com/second"], 8);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).map((p) => p.url)).toEqual(["https://d.example.com/first", "https://d.example.com/second"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns empty when nothing usable arrives", async () => {
    expect(await fetchMultiplePages(["https://d.example.com/a"], 8)).toEqual([]);
  });
});
