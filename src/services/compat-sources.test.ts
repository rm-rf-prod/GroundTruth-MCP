import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MdnDocMeta } from "./mdn-bcd.js";

vi.mock("./mdn-bcd.js", () => ({
  fetchMdnDocMeta: vi.fn(),
  renderBcdTable: vi.fn(async (path: string) => `### Support: \`${path}\`\n| Chrome | 1 |`),
  formatBaseline: () => "",
}));

vi.mock("./fetcher.js", () => ({ fetchAsMarkdownRace: vi.fn() }));

import { fetchMdnDocMeta } from "./mdn-bcd.js";
import { fetchAsMarkdownRace } from "./fetcher.js";
import { fetchBcdSection, fetchRenderedMdn, fetchCaniuse } from "./compat-sources.js";

const META: Record<string, MdnDocMeta> = {
  "https://mdn/dynamic-range-limit": {
    title: "dynamic-range-limit CSS property - CSS | MDN",
    summary: "The dynamic-range-limit CSS property specifies the maximum luminance allowed for High Dynamic Range (HDR) content.",
    browserCompat: ["css.properties.dynamic-range-limit"],
    baseline: null,
    mdnUrl: "https://mdn/dynamic-range-limit",
  },
  "https://mdn/has": {
    title: ":has() CSS pseudo-class - CSS | MDN",
    summary: "The functional :has() CSS pseudo-class represents an element if any of the relative selectors match.",
    browserCompat: ["css.selectors.has"],
    baseline: null,
    mdnUrl: "https://mdn/has",
  },
  "https://mdn/object-groupby": {
    title: "Object.groupBy() - JavaScript | MDN",
    summary: "The Object.groupBy() static method groups the elements of a given iterable, containing arrays with the elements in the group.",
    browserCompat: ["javascript.builtins.Object.groupBy"],
    baseline: null,
    mdnUrl: "https://mdn/object-groupby",
  },
};

beforeEach(() => {
  vi.mocked(fetchMdnDocMeta).mockReset().mockImplementation(async (url: string) => META[url] ?? null);
});

describe("fetchBcdSection — feature match", () => {
  it("rejects a page that shares only a category word and one loose term with the feature", async () => {
    expect(await fetchBcdSection(["https://mdn/dynamic-range-limit"], "CSS dynamic viewport units dvh", undefined)).toBeNull();
  });

  it("accepts the page about the feature", async () => {
    const section = await fetchBcdSection(["https://mdn/dynamic-range-limit", "https://mdn/has"], "css :has() selector", undefined);
    expect(section?.url).toBe("https://mdn/has");
  });

  it("accepts a page whose compat key the feature names, even under a renamed API", async () => {
    const section = await fetchBcdSection(["https://mdn/object-groupby"], "Array.groupBy", undefined);
    expect(section?.url).toBe("https://mdn/object-groupby");
  });
});

const DVH = "CSS dynamic viewport units dvh";
const PAGES: Record<string, string> = {
  "https://mdn/dynamic-range-limit": "# dynamic-range-limit\n\n" +
    "The dynamic-range-limit CSS property sets the maximum luminance of high dynamic range content. ".repeat(6) +
    "\n\n## Browser compatibility\n\nSupported in Chrome 136.",
  "https://mdn/length": "# CSS length units\n\n" +
    "The dynamic viewport units dvh and dvw size boxes against the dynamic viewport, which grows as browser toolbars hide. ".repeat(4) +
    "\n\n## Browser compatibility\n\nSupported in Safari 15.4.",
};

describe("rendered compat pages — feature match", () => {
  beforeEach(() => {
    vi.mocked(fetchAsMarkdownRace).mockReset().mockImplementation(async (url: string) => PAGES[url] ?? null);
  });

  it("skips a rendered MDN page that shares one loose word with the feature", async () => {
    const section = await fetchRenderedMdn(["https://mdn/dynamic-range-limit", "https://mdn/length"], DVH, `${DVH} browser support`, 2000);
    expect(section?.url).toBe("https://mdn/length");
  });

  it("drops a caniuse page that is about another feature", async () => {
    vi.mocked(fetchAsMarkdownRace).mockResolvedValue(PAGES["https://mdn/dynamic-range-limit"] ?? null);
    expect(await fetchCaniuse(DVH, 2000)).toBeNull();
  });
});
