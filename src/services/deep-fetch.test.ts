import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchViaJina, mockIsIndexContent, mockRankIndexLinks } = vi.hoisted(() => ({
  mockFetchViaJina: vi.fn<(url: string) => Promise<string | null>>(),
  mockIsIndexContent: vi.fn<(content: string) => boolean>(),
  mockRankIndexLinks: vi.fn<(content: string, topic: string) => string[]>(),
}));

vi.mock("./fetcher.js", () => ({
  fetchViaJina: mockFetchViaJina,
  isIndexContent: mockIsIndexContent,
  rankIndexLinks: mockRankIndexLinks,
}));

import {
  scoreTopicRelevance,
  extractInternalLinks,
  rankLinksForTopic,
  buildTopicUrls,
  deepFetchForTopic,
} from "./deep-fetch.js";
import type { FetchResult } from "../types.js";

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetchViaJina.mockResolvedValue(null);
  mockIsIndexContent.mockReturnValue(false);
  mockRankIndexLinks.mockReturnValue([]);
});

describe("scoreTopicRelevance", () => {
  it("returns 1 for empty topic", () => {
    expect(scoreTopicRelevance("any content", "")).toBe(1);
  });

  it("returns 1 when all topic tokens found", () => {
    const content = "React navigation with stack navigator and drawer";
    expect(scoreTopicRelevance(content, "navigation stack")).toBe(1);
  });

  it("returns 0.5 when half of topic tokens found", () => {
    const content = "React navigation setup guide";
    expect(scoreTopicRelevance(content, "navigation performance")).toBe(0.5);
  });

  it("returns 0 when no topic tokens found", () => {
    const content = "Getting started with the framework basics";
    expect(scoreTopicRelevance(content, "caching middleware")).toBe(0);
  });

  it("is case insensitive", () => {
    const content = "NAVIGATION setup GUIDE";
    expect(scoreTopicRelevance(content, "navigation guide")).toBe(1);
  });

  it("ignores short stop words in topic", () => {
    const content = "Setting up authentication for the app";
    const score = scoreTopicRelevance(content, "the authentication");
    expect(score).toBe(1);
  });
});

describe("extractInternalLinks", () => {
  it("extracts markdown links from content", () => {
    const content = `
Check out [Navigation Guide](https://docs.example.com/nav) for more.
Also see [Auth Guide](https://docs.example.com/auth).
    `;
    const links = extractInternalLinks(content, "https://docs.example.com/");
    expect(links).toHaveLength(2);
    expect(links[0]!.text).toBe("Navigation Guide");
    expect(links[0]!.url).toBe("https://docs.example.com/nav");
  });

  it("filters out cross-origin links", () => {
    const content = `
See [Internal](https://docs.example.com/guide).
See [External](https://other-site.com/guide).
    `;
    const links = extractInternalLinks(content, "https://docs.example.com/");
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://docs.example.com/guide");
  });

  it("resolves relative URLs", () => {
    const content = "See [Guide](/docs/guide) for more.";
    const links = extractInternalLinks(content, "https://docs.example.com/");
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://docs.example.com/docs/guide");
  });

  it("deduplicates links", () => {
    const content = `
See [Guide A](https://docs.example.com/guide).
See [Guide B](https://docs.example.com/guide).
    `;
    const links = extractInternalLinks(content, "https://docs.example.com/");
    expect(links).toHaveLength(1);
  });

  it("returns empty for invalid baseUrl", () => {
    const links = extractInternalLinks("[Link](https://a.com)", "not-a-url");
    expect(links).toHaveLength(0);
  });

  it("handles content with no links", () => {
    const links = extractInternalLinks("Plain text content", "https://a.com");
    expect(links).toHaveLength(0);
  });
});

describe("rankLinksForTopic", () => {
  const links = [
    { url: "https://docs.example.com/routing", text: "Routing Guide" },
    { url: "https://docs.example.com/auth", text: "Authentication" },
    { url: "https://docs.example.com/nav-routing", text: "Navigation and Routing" },
  ];

  it("scores links by topic word match", () => {
    const ranked = rankLinksForTopic(links, "routing");
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.url).toContain("routing");
  });

  it("ranks multi-word matches higher", () => {
    const ranked = rankLinksForTopic(links, "navigation routing");
    expect(ranked[0]!.url).toBe("https://docs.example.com/nav-routing");
  });

  it("returns empty for empty topic", () => {
    expect(rankLinksForTopic(links, "")).toHaveLength(0);
  });

  it("returns empty for empty links", () => {
    expect(rankLinksForTopic([], "routing")).toHaveLength(0);
  });

  it("filters out zero-score links", () => {
    const ranked = rankLinksForTopic(links, "database migration");
    expect(ranked).toHaveLength(0);
  });
});

describe("buildTopicUrls", () => {
  it("generates default pattern URLs", () => {
    const urls = buildTopicUrls("https://docs.example.com/docs", "caching");
    expect(urls.some((u) => u.includes("/docs/caching"))).toBe(true);
    expect(urls.some((u) => u.includes("/docs/guides/caching"))).toBe(true);
  });

  it("uses custom urlPatterns first", () => {
    const urls = buildTopicUrls("https://example.com/docs", "hooks", ["/api/{slug}"]);
    expect(urls[0]).toBe("https://example.com/api/hooks");
  });

  it("generates both hyphen and slash slug variants", () => {
    const urls = buildTopicUrls("https://example.com", "server rendering");
    const hasHyphen = urls.some((u) => u.includes("server-rendering"));
    const hasSlash = urls.some((u) => u.includes("server/rendering"));
    expect(hasHyphen).toBe(true);
    expect(hasSlash).toBe(true);
  });

  it("deduplicates URLs", () => {
    const urls = buildTopicUrls("https://example.com", "test", ["/docs/{slug}"]);
    const unique = new Set(urls);
    expect(urls.length).toBe(unique.size);
  });

  it("returns empty for invalid docsUrl", () => {
    expect(buildTopicUrls("not-a-url", "test")).toHaveLength(0);
  });
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
    expect(mockFetchViaJina).not.toHaveBeenCalled();
  });

  it("returns original content when topic is empty", async () => {
    const result = await deepFetchForTopic(baseResult, "", "https://docs.example.com");
    expect(result).toBe(baseResult);
  });

  it("tries direct topic URLs when relevance is low", async () => {
    const deepContent = "x".repeat(400);
    mockFetchViaJina.mockImplementation(async (url: string) => {
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
    mockFetchViaJina.mockImplementation(async (url: string) => {
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
    expect(mockRankIndexLinks).toHaveBeenCalledWith(indexResult.content, "authentication middleware");
  });

  it("follows internal links when content is shallow and not index", async () => {
    const shallowResult: FetchResult = {
      content: "Welcome to our library. See [Middleware Guide](https://docs.example.com/guides/middleware) and [Deployment Guide](https://docs.example.com/guides/deployment) for more info.",
      url: "https://docs.example.com",
      sourceType: "jina",
    };

    mockIsIndexContent.mockReturnValue(false);
    mockFetchViaJina.mockImplementation(async (url: string) => {
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
    mockFetchViaJina.mockResolvedValue(null);
    mockIsIndexContent.mockReturnValue(false);

    const result = await deepFetchForTopic(
      baseResult,
      "nonexistent-topic-xyz",
      "https://docs.example.com",
    );
    expect(result).toBe(baseResult);
  });

  it("handles timeout gracefully", async () => {
    mockFetchViaJina.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("x".repeat(400)), 30_000)),
    );

    const result = await deepFetchForTopic(
      baseResult,
      "caching",
      "https://docs.example.com",
      undefined,
      5,
    );
    expect(result).toBe(baseResult);
  }, 35_000);

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

    mockFetchViaJina.mockImplementation(async (url: string) => {
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

  it("uses custom urlPatterns", async () => {
    const deepContent = "x".repeat(400);
    mockFetchViaJina.mockImplementation(async (url: string) => {
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
});
