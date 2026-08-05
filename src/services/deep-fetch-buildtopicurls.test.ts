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
