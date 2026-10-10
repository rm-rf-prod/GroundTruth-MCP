import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../fetcher.js", () => ({ fetchDocs: vi.fn() }));
vi.mock("../deep-fetch.js", () => ({ deepFetchForTopic: vi.fn() }));
vi.mock("./race.js", () => ({ raceUrls: vi.fn() }));
vi.mock("./discovery.js", () => ({
  sitemapCandidates: vi.fn(async () => []),
  fetchDocsLlmsTxt: vi.fn(async () => null),
  fetchFromGitHub: vi.fn(async () => null),
}));

import { fetchDocs } from "../fetcher.js";
import { deepFetchForTopic } from "../deep-fetch.js";
import { raceUrls } from "./race.js";
import { fetchBestPracticesContent } from "./fetch.js";

const DOCS = "https://lib.dev/guide";
const genericPage = {
  url: "https://lib.dev/docs/guide",
  content: "# Introduction\n\n" + "This framework renders user interfaces with a reactive core. ".repeat(10),
  extraUrls: [],
};
const topicPage = "# Composables\n\n" + "A composable is a function that uses composables state. ".repeat(10);

const run = (urlPatterns?: string[]) =>
  fetchBestPracticesContent("x/lib", DOCS, undefined, undefined, undefined, "composables", 2000,
    ["/guide/best-practices/performance"], urlPatterns);

beforeEach(() => {
  vi.mocked(raceUrls).mockReset().mockResolvedValue(null);
  vi.mocked(fetchDocs).mockReset().mockResolvedValue({ content: topicPage, url: DOCS, sourceType: "llms-txt" });
  vi.mocked(deepFetchForTopic).mockReset().mockImplementation(async (r) => r);
});

describe("fetchBestPracticesContent — generic pages and URL patterns", () => {
  it("skips a generic best-practices page that never covers the topic", async () => {
    // The fixed perf page never mentions the topic, so it is deferred: the first
    // race is the topic-slug guess, the second the generic suffixes.
    vi.mocked(raceUrls).mockResolvedValueOnce(null).mockResolvedValueOnce(genericPage);
    const out = await run();
    expect(out.sourceUrl).toBe(DOCS);
    expect(out.text).toContain("composable");
  });

  it("still returns a generic page that does cover the topic", async () => {
    const onTopic = { ...genericPage, content: topicPage };
    vi.mocked(raceUrls).mockResolvedValueOnce(null).mockResolvedValueOnce(onTopic);
    const out = await run();
    expect(out.sourceUrl).toBe(genericPage.url);
  });

  it("gives deep fetch the registry URL patterns, never the fixed best-practices pages", async () => {
    await run(["/guide/{slug}"]);
    expect(vi.mocked(deepFetchForTopic).mock.calls[0]?.[3]).toEqual(["/guide/{slug}"]);
    await run();
    expect(vi.mocked(deepFetchForTopic).mock.calls[1]?.[3]).toBeUndefined();
  });
});
