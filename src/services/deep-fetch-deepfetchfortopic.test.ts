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

  it("returns original content when relevance is high", async () => {
    const result = await deepFetchForTopic(
      relevantResult,
      "caching",
      "https://docs.example.com",
    );
    expect(result).toBe(relevantResult);
    expect(mockFetchAsMarkdownRace).not.toHaveBeenCalled();
  });

  it("returns original content when topic is empty", async () => {
    const result = await deepFetchForTopic(baseResult, "", "https://docs.example.com");
    expect(result).toBe(baseResult);
  });

  it("tries direct topic URLs when relevance is low", async () => {
    const deepContent = "x".repeat(400);
    mockFetchAsMarkdownRace.mockImplementation(async (url: string) => {
      if (url.includes("/docs/caching") || url.includes("/docs/guides/caching")) {
        return deepContent;
      }
      return null;
    });

    const result = await deepFetchForTopic(
      baseResult,
      "caching",
      "https://docs.example.com",
    );
    expect(result.sourceType).toBe("deep-fetch");
    expect(result.content).toBe(deepContent);
  });

  it("follows index links when content is a TOC", async () => {
    const indexResult: FetchResult = {
      content: "- [Guide A](https://docs.example.com/a)\n- [Guide B](https://docs.example.com/b)\n- [Zebra](https://docs.example.com/zebra)\n- [D](https://d.com/d)\n- [E](https://e.com/e)",
      url: "https://docs.example.com",
      sourceType: "llms-txt",
    };

    mockIsIndexContent.mockReturnValue(true);
    mockRankIndexLinks.mockReturnValue([
      "https://docs.example.com/zebra",
      "https://docs.example.com/a",
    ]);
    mockFetchAsMarkdownRace.mockImplementation(async (url: string) => {
      if (url === "https://docs.example.com/zebra") {
        return "x".repeat(400);
      }
      return null;
    });

    const result = await deepFetchForTopic(
      indexResult,
      "authentication middleware",
      "https://docs.example.com",
    );
    expect(result.sourceType).toBe("deep-fetch");
    expect(mockRankIndexLinks).toHaveBeenCalledWith(indexResult.content, "authentication middleware", "https://docs.example.com");
  });

  it("follows internal links when content is shallow and not index", async () => {
    const shallowResult: FetchResult = {
      content: "Welcome to our library. See [Middleware Guide](https://docs.example.com/guides/middleware) and [Deployment Guide](https://docs.example.com/guides/deployment) for more info.",
      url: "https://docs.example.com",
      sourceType: "jina",
    };

    mockIsIndexContent.mockReturnValue(false);
    mockFetchAsMarkdownRace.mockImplementation(async (url: string) => {
      if (url === "https://docs.example.com/guides/middleware") {
        return "Detailed middleware patterns " + "x".repeat(400);
      }
      return null;
    });

    const result = await deepFetchForTopic(
      shallowResult,
      "middleware patterns",
      "https://docs.example.com",
    );
    expect(result.sourceType).toBe("deep-fetch");
    expect(result.content).toContain("Detailed middleware patterns");
  });

  it("returns original when all deep-fetch attempts fail", async () => {
    mockFetchAsMarkdownRace.mockResolvedValue(null);
    mockIsIndexContent.mockReturnValue(false);

    const result = await deepFetchForTopic(
      baseResult,
      "nonexistent-topic-xyz",
      "https://docs.example.com",
    );
    expect(result).toBe(baseResult);
  });

  it("handles timeout gracefully", async () => {
    mockFetchAsMarkdownRace.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("x".repeat(400)), 40_000)),
    );

    const result = await deepFetchForTopic(
      baseResult,
      "caching",
      "https://docs.example.com",
      undefined,
      5,
    );
    expect(result).toBe(baseResult);
  }, 45_000);

  it("assembles multiple pages from index links", async () => {
    const indexResult: FetchResult = {
      content: "- [Alpha](https://docs.example.com/a)\n- [Beta](https://docs.example.com/b)\n- [Gamma](https://docs.example.com/c)\n- [Delta](https://d.com/d)\n- [Epsilon](https://e.com/e)",
      url: "https://docs.example.com",
      sourceType: "llms-txt",
    };

    mockIsIndexContent.mockReturnValue(true);
    mockRankIndexLinks.mockReturnValue([
      "https://docs.example.com/a",
      "https://docs.example.com/b",
    ]);

    const pageA = "Content of page A " + "x".repeat(300);
    const pageB = "Content of page B " + "y".repeat(300);

    mockFetchAsMarkdownRace.mockImplementation(async (url: string) => {
      if (url === "https://docs.example.com/a") return pageA;
      if (url === "https://docs.example.com/b") return pageB;
      return null;
    });

    const result = await deepFetchForTopic(
      indexResult,
      "serialization protocols",
      "https://docs.example.com",
    );

    expect(result.sourceType).toBe("deep-fetch");
    expect(result.content).toContain("Content of page A");
    expect(result.content).toContain("Content of page B");
    expect(result.content).toContain("## Source:");
  });

});
