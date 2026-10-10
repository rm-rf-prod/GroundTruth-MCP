import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../fetcher.js", () => ({
  fetchWithTimeout: vi.fn(),
  hashContent: (s: string) => s,
}));

import { fetchWithTimeout } from "../fetcher.js";
import { docCache } from "../cache.js";
import { searchMDN, webSearch } from "./engines.js";

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
const MDN = { documents: [{ mdn_url: "/en-US/docs/Web/CSS/:has", title: ":has()" }] };
const DDG_HTML = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.postgresql.org%2Fdocs%2Fcurrent%2Fddl-rowsecurity.html">x</a>';

beforeEach(() => {
  docCache.clear();
  vi.mocked(fetchWithTimeout).mockReset();
});

describe("search engine result cache", () => {
  it("answers a repeated MDN search from cache", async () => {
    vi.mocked(fetchWithTimeout).mockImplementation(async () => json(MDN));
    const first = await searchMDN("css :has() selector");
    const second = await searchMDN("css :has() selector");
    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not remember an empty MDN answer", async () => {
    vi.mocked(fetchWithTimeout).mockImplementation(async () => json({ documents: [] }));
    await searchMDN("nothing here");
    await searchMDN("nothing here");
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  it("answers a repeated web search from cache", async () => {
    vi.mocked(fetchWithTimeout).mockImplementation(async () => new Response(DDG_HTML, { status: 200 }));
    const first = await webSearch("postgres row level security");
    const second = await webSearch("postgres row level security");
    expect(first[0]).toBe("https://www.postgresql.org/docs/current/ddl-rowsecurity.html");
    expect(second).toEqual(first);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });
});
