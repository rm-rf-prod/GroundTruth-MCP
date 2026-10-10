import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-md-swr-"));
});

import { fetchAsMarkdown, fetchAsMarkdownRace } from "./markdown.js";
import { docCache, diskDocCache } from "../cache.js";
import { clearNegativeCache } from "./negative-cache.js";
import { resetAllCircuits } from "../circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const jinaCalls = () => mockFetch.mock.calls.filter(([u]) => String(u).startsWith("https://r.jina.ai/")).length;
const prose = (title: string) => `# ${title}\n\n` + "Documentation prose about caching and revalidation. ".repeat(12);
const jsxDoc = "---\ntitle: JSX\n---\n\n```jsx\n" + "<div className=\"card\"><b>hi</b></div>\n".repeat(30) + "```\n" + "Explanation of the example above. ".repeat(10);
const rscPage =
  "<!DOCTYPE html><html><head><title>t</title></head><body><main><h1>Caching</h1>" +
  "<p>Request memoization dedupes fetch calls during one render pass of the tree.</p>".repeat(6) +
  `</main><script>self.__next_f.push([1, ${JSON.stringify("x".repeat(80_000))}])</script></body></html>`;

/** Spins the event loop (setImmediate is not faked) until `cond` holds; bounded by wall time so a loaded CI box does not flake. */
async function until(cond: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!cond() && performance.now() < deadline) await new Promise((r) => setImmediate(r));
  expect(cond()).toBe(true);
}

function route(direct: () => Promise<Response>) {
  mockFetch.mockImplementation(async (input) =>
    String(input).startsWith("https://r.jina.ai/") ? new Response(prose("From Jina")) : direct(),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  docCache.clear();
  clearNegativeCache();
  resetAllCircuits();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(process.env.GT_CACHE_DIR ?? "", { recursive: true, force: true });
});

describe("fetchAsMarkdownRace direct path", () => {
  it("converts a script-heavy SSR page instead of falling to Jina (NET-01)", async () => {
    route(async () => new Response(rscPage, { headers: { "content-type": "text/html" } }));
    const md = await fetchAsMarkdownRace("https://ssr.example.com/docs/caching");
    expect(md).toContain("# Caching");
    expect(md).not.toContain("<!DOCTYPE");
    expect(jinaCalls()).toBe(0);
  });

  it("keeps server markdown as-is, JSX in code intact (NET-04, ACC-01)", async () => {
    route(async () => new Response(jsxDoc, { headers: { "content-type": "text/markdown; charset=utf-8" } }));
    expect(await fetchAsMarkdownRace("https://md.example.com/learn/jsx")).toBe(jsxDoc);
    expect(jinaCalls()).toBe(0);
  });
});

describe("fetchAsMarkdownRace Jina hedge (NET-02)", () => {
  it("starts Jina at once when the direct path fails", async () => {
    route(async () => new Response("blocked", { status: 403 }));
    expect(await fetchAsMarkdownRace("https://blocked.example.com/page")).toContain("From Jina");
    expect(jinaCalls()).toBe(1);
  });

  it("never renders a page that answered 404 (ACC-02)", async () => {
    route(async () => new Response("gone", { status: 404 }));
    expect(await fetchAsMarkdownRace("https://dead.example.com/page")).toBeNull();
    expect(await fetchAsMarkdown("https://dead.example.com/other")).toBeNull();
    expect(jinaCalls()).toBe(0);
  });

  it("holds Jina back while a slow direct fetch is under the hedge delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answer: (r: Response) => void = () => {};
    route(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const pending = fetchAsMarkdownRace("https://slow.example.com/page");
    await until(() => mockFetch.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(jinaCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    await until(() => jinaCalls() === 1);
    answer(new Response(prose("Direct")));
    expect(await pending).toBeTruthy();
  });
});

describe("thin direct conversions", () => {
  // The article is a sliver next to a 1,000-link sidebar, so the floor hands the page to Jina.
  const thinPage = `<!DOCTYPE html><html><body><nav>${"<a href='/x'>Sidebar entry text</a> ".repeat(1_000)}</nav>` +
    `<main><h1>Short</h1>${"<p>A short reference page that still answers the question asked.</p>".repeat(4)}</main></body></html>`;
  const jinaDown = () => mockFetch.mockImplementation(async (input) =>
    String(input).startsWith("https://r.jina.ai/") ? new Response("", { status: 400 }) : new Response(thinPage, { headers: { "content-type": "text/html" } }));

  it("answer with the thin conversion when Jina has nothing either", async () => {
    jinaDown();
    expect(await fetchAsMarkdown("https://thin.example.com/docs/a")).toContain("# Short");
    expect(await fetchAsMarkdownRace("https://thin.example.com/docs/b")).toContain("# Short");
    // Each call asked Jina first; a loaded machine can add one retry inside fetchViaJina.
    expect(jinaCalls()).toBeGreaterThanOrEqual(2);
  });

  it("lose to Jina when it renders the page", async () => {
    route(async () => new Response(thinPage, { headers: { "content-type": "text/html" } }));
    expect(await fetchAsMarkdownRace("https://thin.example.com/docs/c")).toContain("From Jina");
  });
});

describe("oversized direct pages", () => {
  it("still fall back to Jina: only the direct download is futile", async () => {
    route(async () => new Response("x", { headers: { "content-type": "text/html", "content-length": String(6 * 1024 * 1024) } }));
    expect(await fetchAsMarkdown("https://big.example.com/docs/a")).toContain("From Jina");
    expect(await fetchAsMarkdownRace("https://big.example.com/docs/b")).toContain("From Jina");
    expect(jinaCalls()).toBe(2);
  });
});

describe("fetchAsMarkdownRace stale-while-revalidate (NET-05)", () => {
  it("serves a day-old disk entry at once and refreshes it once in the background", async () => {
    const url = "https://swr.example.com/docs/page";
    await diskDocCache.set(`md:${url}`, prose("Yesterday"), -24 * 3_600_000);
    let answer: (r: Response) => void = () => {};
    route(() => new Promise<Response>((resolve) => { answer = resolve; }));

    expect(await fetchAsMarkdownRace(url)).toContain("# Yesterday");
    expect(await fetchAsMarkdownRace(url)).toContain("# Yesterday");
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    answer(new Response(prose("Today"), { headers: { "content-type": "text/markdown" } }));
    await vi.waitFor(async () => expect(await fetchAsMarkdownRace(url)).toContain("# Today"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
