import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./fetcher.js", () => ({
  fetchWithTimeout: vi.fn(),
  githubAuthHeaders: () => ({}),
  hashContent: (s: string) => s,
  fetchNpmPackage: vi.fn(),
  fetchPypiPackage: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
}));
vi.mock("./resolve/llms-probe.js", () => ({ probeLlmsTxt: vi.fn(async () => ({})) }));

import { fetchWithTimeout } from "./fetcher.js";
import { docCache, resolveCache } from "./cache.js";
import { searchMDN, searchDDGInstant, webSearch } from "./search/engines.js";
import { fetchMdnDocMeta } from "./mdn-bcd.js";
import { searchNpm, searchGitHub } from "./resolve/search.js";
import { resolveFromCrates } from "./resolve/registries.js";

const cancel = vi.fn(async () => {});

/** A non-ok answer whose unread body would keep the socket and the 15 s timer alive. */
const failing = (status: number) => (): Response =>
  ({ ok: false, status, headers: new Headers(), body: { cancel } }) as unknown as Response;

beforeEach(() => {
  docCache.clear();
  resolveCache.clear();
  cancel.mockClear();
  vi.mocked(fetchWithTimeout).mockReset().mockImplementation(async () => failing(503)());
});

describe("non-ok bodies are discarded, not left open", () => {
  it.each([
    ["MDN search", () => searchMDN("css :has() selector")],
    ["DuckDuckGo instant answers", () => searchDDGInstant("postgres row level security")],
    ["MDN index.json", () => fetchMdnDocMeta("https://developer.mozilla.org/en-US/docs/Web/CSS/:has")],
    ["npm search", () => searchNpm("left-pad")],
    ["GitHub repository search", () => searchGitHub("left-pad")],
    ["crates.io", () => resolveFromCrates("serde")],
  ])("%s", async (_name, call) => {
    await call();
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("every web-search engine that answers non-ok", async () => {
    await webSearch("postgres row level security");
    const calls = vi.mocked(fetchWithTimeout).mock.calls.length;
    expect(calls).toBeGreaterThan(3);
    expect(cancel).toHaveBeenCalledTimes(calls);
  });
});
