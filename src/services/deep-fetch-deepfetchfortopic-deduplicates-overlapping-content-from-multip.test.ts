import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchViaJina, mockFetchAsMarkdownRace, mockIsIndexContent, mockRankIndexLinks, mockLog } = vi.hoisted(() => ({
  mockFetchViaJina: vi.fn<(url: string) => Promise<string | null>>(),
  mockFetchAsMarkdownRace: vi.fn<(url: string) => Promise<string | null>>(),
  mockIsIndexContent: vi.fn<(content: string) => boolean>(),
  mockRankIndexLinks: vi.fn<(content: string, topic: string) => string[]>(),
  mockLog: vi.fn(),
}));

vi.mock("./fetcher.js", () => ({
  fetchViaJina: mockFetchViaJina,
  fetchAsMarkdownRace: mockFetchAsMarkdownRace,
  isIndexContent: mockIsIndexContent,
  rankIndexLinks: mockRankIndexLinks,
}));

vi.mock("../utils/logger.js", () => ({
  log: mockLog,
}));

import {
  scoreTopicRelevance,
  extractInternalLinks,
  rankLinksForTopic,
  buildTopicUrls,
  deepFetchForTopic,
} from "./deep-fetch.js";
import type { FetchResult } from "../types.js";
import { DEEP_FETCH_TIMEOUT_MS } from "../constants.js";

beforeEach(() => {
  vi.restoreAllMocks();
  mockLog.mockReset();
  mockFetchViaJina.mockResolvedValue(null);
  mockFetchAsMarkdownRace.mockResolvedValue(null);
  mockIsIndexContent.mockReturnValue(false);
  mockRankIndexLinks.mockReturnValue([]);
});

describe("deepFetchForTopic", () => {
  const baseResult: FetchResult = {
    content: "Generic homepage content that does not mention any specific topic at all",
    url: "https://docs.example.com",
    sourceType: "jina",
  };

  const relevantResult: FetchResult = {
    content: "Detailed guide about caching strategies including caching layers and cache invalidation patterns for optimal performance with distributed caching",
    url: "https://docs.example.com",
    sourceType: "jina",
  };

  it("deduplicates overlapping content from multiple pages", async () => {
    const sharedParagraph = "This is a shared navigation paragraph that appears on every page of the documentation site and should only appear once in the assembled output.";
    const indexResult: FetchResult = {
      content: "- [A](https://docs.example.com/a)\n- [B](https://docs.example.com/b)\n- [C](https://c.com/c)\n- [D](https://d.com/d)\n- [E](https://e.com/e)",
      url: "https://docs.example.com",
      sourceType: "llms-txt",
    };

    mockIsIndexContent.mockReturnValue(true);
    mockRankIndexLinks.mockReturnValue([
      "https://docs.example.com/a",
      "https://docs.example.com/b",
    ]);

    mockFetchAsMarkdownRace.mockImplementation(async (url: string) => {
      if (url === "https://docs.example.com/a") return `Page A content\n\n${sharedParagraph}\n\n` + "x".repeat(300);
      if (url === "https://docs.example.com/b") return `Page B content\n\n${sharedParagraph}\n\n` + "y".repeat(300);
      return null;
    });

    const result = await deepFetchForTopic(
      indexResult,
      "serialization xyz",
      "https://docs.example.com",
    );

    const occurrences = result.content.split(sharedParagraph).length - 1;
    expect(occurrences).toBe(1);
  });

  it("uses custom urlPatterns", async () => {
    const deepContent = "x".repeat(400);
    mockFetchAsMarkdownRace.mockImplementation(async (url: string) => {
      if (url.includes("/custom/caching")) return deepContent;
      return null;
    });

    const result = await deepFetchForTopic(
      baseResult,
      "caching",
      "https://docs.example.com",
      ["/custom/{slug}"],
    );
    expect(result.sourceType).toBe("deep-fetch");
    expect(result.content).toBe(deepContent);
  });

  it("fires at most 6 concurrent topicUrl fetches (PERF-006)", async () => {
    // All fetches return null so no direct hit succeeds.
    // After the 6-URL direct-hit phase, the index path is skipped (not index
    // content), the internal-links path is skipped (no links in content), and
    // fetchSitemapUrls (not mocked) throws, which is caught and returns the
    // original result.  mockFetchAsMarkdownRace must therefore be called at
    // most 6 times.
    mockFetchAsMarkdownRace.mockClear();
    mockFetchAsMarkdownRace.mockResolvedValue(null);
    mockIsIndexContent.mockReturnValue(false);

    await deepFetchForTopic(
      baseResult,
      "caching",
      "https://docs.example.com",
    );

    expect(mockFetchAsMarkdownRace.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("logs level=warn msg=deep-fetch-timeout when pipeline times out (OBS-006)", async () => {
    // Make every fetch hang so the pipeline never resolves.
    mockFetchAsMarkdownRace.mockImplementation(() => new Promise(() => {}));
    mockIsIndexContent.mockReturnValue(false);

    vi.useFakeTimers();
    try {
      const promise = deepFetchForTopic(
        baseResult,
        "caching",
        "https://docs.example.com",
      );
      // Advance past the deep-fetch timeout so the setTimeout rejection fires.
      await vi.advanceTimersByTimeAsync(DEEP_FETCH_TIMEOUT_MS + 1);
      await promise;
    } finally {
      vi.useRealTimers();
    }

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", msg: "deep-fetch-timeout" }),
    );
  });
});
