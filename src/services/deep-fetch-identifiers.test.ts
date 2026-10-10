import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRace } = vi.hoisted(() => ({ mockRace: vi.fn<(url: string) => Promise<string | null>>() }));

vi.mock("./fetcher.js", () => ({
  fetchAsMarkdownRace: mockRace,
  isIndexContent: () => false,
  rankIndexLinks: () => [],
  fetchSitemapUrls: async () => [],
}));
vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));

import { deepFetchForTopic, scoreTopicRelevance } from "./deep-fetch.js";
import { DEEP_FETCH_RELEVANCE_THRESHOLD } from "../constants.js";
import type { FetchResult } from "../types.js";

const TOPIC = "vi.mock module mocking";
const API_PAGE = "Call vi.mock(path, factory) to replace a module. ".repeat(10);

beforeEach(() => {
  mockRace.mockReset();
  mockRace.mockResolvedValue(API_PAGE);
});

describe("deepFetchForTopic early exit — topic identifiers (ACC-09)", () => {
  // Every split word is on the page, so the lexical relevance score passes it.
  const nearby: FetchResult = {
    content: "Module mocking: how to mock a module with module mocking helpers. See [Mocking API](https://vitest.dev/api/vi).",
    url: "https://vitest.dev/guide/mocking",
    sourceType: "direct",
  };

  it("keeps hunting when an identifier is missing verbatim from the page", async () => {
    expect(scoreTopicRelevance(nearby.content, TOPIC)).toBeGreaterThanOrEqual(DEEP_FETCH_RELEVANCE_THRESHOLD);
    const result = await deepFetchForTopic(nearby, TOPIC, "https://vitest.dev/guide");
    expect(result.url).toBe("https://vitest.dev/api/vi");
    expect(mockRace).toHaveBeenCalled();
  });

  it("still exits early when the identifier is on the page", async () => {
    const onPage = { ...nearby, content: `${nearby.content} Use vi.mock() at the top of the file.` };
    const result = await deepFetchForTopic(onPage, TOPIC, "https://vitest.dev/guide");
    expect(result).toBe(onPage);
    expect(mockRace).not.toHaveBeenCalled();
  });
});
