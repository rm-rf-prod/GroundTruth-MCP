import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../cache.js", () => ({ docCache: { get: () => undefined, set: () => undefined } }));
vi.mock("../fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchDevDocs: vi.fn(async () => null),
  fetchAsMarkdownRace: vi.fn(),
  isErrorPage: () => false,
  hashContent: (s: string) => s,
}));
vi.mock("../deep-fetch.js", () => ({ deepFetchForTopic: vi.fn(async (r: unknown) => r) }));
vi.mock("./registry-match.js", () => ({ registryMatches: vi.fn(() => []) }));
vi.mock("../../sources/registry.js", () => ({ lookupById: vi.fn() }));
vi.mock("./topic-match.js", () => ({ findTopicUrls: vi.fn(() => []) }));
vi.mock("./candidates.js", () => ({ buildDirectDocsUrls: () => [], buildJinaFallbackUrls: () => [] }));
vi.mock("./engines.js", () => ({
  searchMDN: vi.fn(async () => []),
  searchDDGInstant: vi.fn(async () => []),
  webSearch: vi.fn(async () => []),
}));

import { fetchDocs, fetchAsMarkdownRace } from "../fetcher.js";
import { deepFetchForTopic } from "../deep-fetch.js";
import { registryMatches } from "./registry-match.js";
import { lookupById } from "../../sources/registry.js";
import { findTopicUrls } from "./topic-match.js";
import { searchMDN } from "./engines.js";
import { collectSearchSources } from "./collect.js";

const PG = "https://www.postgresql.org/docs/current/ddl-rowsecurity.html";
const ARIA = "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-level";
const pages: Record<string, string> = {
  [PG]: "# Row Security Policies\n\n" + "Postgres row level security restricts rows per user with policies. ".repeat(10),
  [ARIA]: "# ARIA: aria-level attribute\n\n" + "The aria-level attribute sets the level of a row in a tree grid. ".repeat(10),
};

beforeEach(() => {
  vi.mocked(fetchAsMarkdownRace).mockReset().mockImplementation(async (url: string) => pages[url] ?? null);
  vi.mocked(registryMatches).mockReset().mockReturnValue([]);
  vi.mocked(findTopicUrls).mockReset().mockReturnValue([]);
  vi.mocked(searchMDN).mockReset().mockResolvedValue([]);
});

describe("collectSearchSources", () => {
  it("drops a fuzzy MDN page that covers half of a specific query when a source exists", async () => {
    vi.mocked(findTopicUrls).mockReturnValue([{ name: "Postgres Row Level Security", urls: [PG] }]);
    vi.mocked(searchMDN).mockResolvedValue([{ url: ARIA, title: "ARIA: aria-level attribute" }]);
    const { results } = await collectSearchSources("postgres row level security", 4000);
    expect(results.map((r) => r.url)).toEqual([PG]);
  });

  it("looks up the topic without the library name in the registry stage", async () => {
    const entry = { id: "supabase/supabase", name: "Supabase", docsUrl: "https://supabase.com/docs", urlPatterns: [] };
    vi.mocked(registryMatches).mockReturnValue([{ id: entry.id, topic: "row level security" }]);
    vi.mocked(lookupById).mockReturnValue(entry as never);
    vi.mocked(fetchDocs).mockResolvedValue({
      content: "# Row Level Security\n\n" + "Enable row level security and write policies. ".repeat(10),
      url: "https://supabase.com/docs/guides/auth/row-level-security",
      sourceType: "llms-txt",
    });
    const { results } = await collectSearchSources("supabase row level security", 4000);
    expect(vi.mocked(deepFetchForTopic).mock.calls[0]?.[1]).toBe("row level security");
    // With the topic, an oversized llms-full.txt library answers from its llms.txt index.
    expect(vi.mocked(fetchDocs).mock.calls[0]?.[3]).toBe("row level security");
    expect(results[0]?.source).toBe("Supabase");
  });
});
