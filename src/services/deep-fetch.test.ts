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

describe("scoreTopicRelevance", () => {
  it("returns 1 for empty topic", () => {
    expect(scoreTopicRelevance("any content", "")).toBe(1);
  });

  it("returns high score when all tokens and phrase found", () => {
    const content = "React navigation stack guide for mobile apps";
    expect(scoreTopicRelevance(content, "navigation stack")).toBe(1);
  });

  it("returns partial score when tokens found but phrase missing", () => {
    const content = "React navigation with stack navigator and drawer";
    const score = scoreTopicRelevance(content, "navigation stack");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns low score when half of topic tokens found", () => {
    const content = "React navigation setup guide";
    const score = scoreTopicRelevance(content, "navigation performance");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it("returns 0 when no topic tokens found", () => {
    const content = "Getting started with the framework basics";
    expect(scoreTopicRelevance(content, "caching middleware")).toBe(0);
  });

  it("is case insensitive", () => {
    const content = "NAVIGATION GUIDE for mobile apps";
    expect(scoreTopicRelevance(content, "navigation guide")).toBe(1);
  });

  it("ignores short stop words in topic", () => {
    const content = "Setting up authentication for the app";
    const score = scoreTopicRelevance(content, "the authentication");
    expect(score).toBe(1);
  });

  it("scores higher with bigram phrase matches", () => {
    const contentWithPhrase = "Learn about server actions and how to use them in your app";
    const contentWithSeparateWords = "The server is fast. User actions are logged.";
    const phraseScore = scoreTopicRelevance(contentWithPhrase, "server actions");
    const separateScore = scoreTopicRelevance(contentWithSeparateWords, "server actions");
    expect(phraseScore).toBeGreaterThan(separateScore);
  });

  it("uses full topic phrase matching for multi-word topics", () => {
    const content = "A guide to react server components and how they work";
    const score = scoreTopicRelevance(content, "react server components");
    expect(score).toBeGreaterThan(0.5);
  });

  it("falls back to token-only scoring for single-word topics", () => {
    const content = "Setting up authentication in your application";
    const score = scoreTopicRelevance(content, "authentication");
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
