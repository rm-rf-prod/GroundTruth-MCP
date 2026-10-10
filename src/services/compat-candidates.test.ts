import { describe, it, expect, vi } from "vitest";

const MDN = "https://developer.mozilla.org/en-US/docs/Web/CSS";
// MDN's live answer for "container queries": six guides, then the reference pages that carry BCD.
const HITS = [
  "Guides/Containment/Container_queries",
  "Guides/Anchor_positioning/Anchored_container_queries",
  "Guides/Containment/Container_size_and_style_queries",
  "Guides/Conditional_rules/Container_scroll-state_queries",
  "Guides/Media_queries",
  "Guides/Media_queries/Using",
  "Reference/Properties/container-type",
  "Reference/At-rules/@container",
  "Reference/Properties/container-name",
  "Reference/Properties/container",
].map((path) => ({ url: `${MDN}/${path}`, title: path }));

vi.mock("./search/engines.js", () => ({ searchMDN: vi.fn(async () => HITS) }));
vi.mock("./search/topic-match.js", () => ({ findTopicUrls: () => [] }));
vi.mock("./fetcher.js", () => ({ fetchAsMarkdownRace: vi.fn() }));

import { resolveMdnCandidates } from "./compat-sources.js";

describe("resolveMdnCandidates", () => {
  it("keeps reference pages MDN ranks below six guides, and probes them first", async () => {
    const candidates = await resolveMdnCandidates("container queries");
    expect(candidates.slice(0, 4)).toEqual([
      `${MDN}/Reference/Properties/container-type`,
      `${MDN}/Reference/At-rules/@container`,
      `${MDN}/Reference/Properties/container-name`,
      `${MDN}/Reference/Properties/container`,
    ]);
    expect(candidates).toHaveLength(10);
  });
});
