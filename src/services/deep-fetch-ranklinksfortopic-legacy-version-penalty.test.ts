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

describe("rankLinksForTopic legacy-version penalty", () => {
  it("ranks the current unversioned doc above archived version trees", () => {
    const links = [
      { url: "https://docs.example.com/proj/docs/2.x/api/hooks/useSharedValue", text: "useSharedValue" },
      { url: "https://docs.example.com/proj/docs/core/useSharedValue", text: "useSharedValue" },
      { url: "https://docs.example.com/proj/docs/legacy/shared-values", text: "shared values" },
    ];
    const ranked = rankLinksForTopic(links, "shared value");
    expect(ranked[0]?.url).toBe("https://docs.example.com/proj/docs/core/useSharedValue");
  });
});
