import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { rmSync } from "fs";

await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  process.env.GT_CACHE_DIR = mkdtempSync(join(tmpdir(), "gt-doc-fetch-"));
});

import { fetchDocs } from "./doc-fetch.js";
import { docCache, diskDocCache, llmsProbeCache } from "./cache.js";
import { clearNegativeCache } from "./http/negative-cache.js";
import { MARKDOWN_ACCEPT } from "./http/request.js";
import { resetAllCircuits } from "./circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const urls = () => mockFetch.mock.calls.map(([u]) => String(u));
const jinaCalls = () => urls().filter((u) => u.startsWith("https://r.jina.ai/")).length;
const prose = (title: string) => `# ${title}\n\n` + "Documentation prose about routing and caching. ".repeat(12);
const rscPage =
  "<!DOCTYPE html><html><head><title>t</title></head><body><main><h1>Caching</h1>" +
  "<p>Request memoization dedupes fetch calls during one render pass of the tree.</p>".repeat(6) +
  `</main><script>self.__next_f.push([1, ${JSON.stringify("x".repeat(80_000))}])</script></body></html>`;
const gone = () => new Response("not found", { status: 404 });

/** Route by URL; anything unrouted (llms probes, Jina) answers 404. */
function route(table: Record<string, () => Response | Promise<Response>>): void {
  mockFetch.mockImplementation(async (input) => (table[String(input)] ?? gone)());
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  docCache.clear();
  llmsProbeCache.clear();
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

describe("fetchDocs direct page (NET-01, NET-04)", () => {
  it("converts a script-heavy SSR page instead of falling to Jina", async () => {
    route({ "https://ssr.example.com/docs": () => new Response(rscPage, { headers: { "content-type": "text/html" } }) });
    const result = await fetchDocs("https://ssr.example.com/docs");
    expect(result.sourceType).toBe("direct");
    expect(result.content).toContain("# Caching");
    expect(jinaCalls()).toBe(0);
  });

  it("asks for markdown and keeps the server's own markdown as-is", async () => {
    const md = prose("Server markdown");
    route({ "https://md.example.com/docs": () => new Response(md, { headers: { "content-type": "text/markdown" } }) });
    expect((await fetchDocs("https://md.example.com/docs")).content).toBe(md);
    const call = mockFetch.mock.calls.find(([u]) => String(u) === "https://md.example.com/docs");
    expect((call?.[1]?.headers as Record<string, string>).Accept).toBe(MARKDOWN_ACCEPT);
  });
});

describe("fetchDocs Jina hedge (NET-02)", () => {
  it("holds Jina back while a slow direct fetch is under 1.5 s, then starts it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answer: (r: Response) => void = () => {};
    mockFetch.mockImplementation(async (input) => {
      const u = String(input);
      if (u === "https://slow.example.com/docs") return new Promise<Response>((resolve) => { answer = resolve; });
      return u.startsWith("https://r.jina.ai/") ? new Response(prose("From Jina")) : gone();
    });
    const pending = fetchDocs("https://slow.example.com/docs");
    await vi.waitFor(() => expect(urls()).toContain("https://slow.example.com/docs"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(jinaCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect((await pending).sourceType).toBe("jina");
    answer(new Response(prose("Direct")));
  });
});

describe("fetchDocs llms discovery runs beside the page (NET-07)", () => {
  it("fetches the page while the llms probe is still out, and prefers a found llms file", async () => {
    const index = "- [Routing](https://probe.example.com/docs/routing)\n".repeat(20);
    let releaseProbe: () => void = () => {};
    let releasePage: () => void = () => {};
    const probeGate = new Promise<void>((r) => { releaseProbe = r; });
    const pageGate = new Promise<void>((r) => { releasePage = r; });
    route({
      "https://probe.example.com/docs": async () => {
        await pageGate;
        return new Response(prose("Page"), { headers: { "content-type": "text/markdown" } });
      },
      "https://probe.example.com/llms.txt": async () => { await probeGate; return new Response(index); },
    });
    const pending = fetchDocs("https://probe.example.com/docs");
    await vi.waitFor(() => expect(urls()).toContain("https://probe.example.com/docs"));
    releaseProbe();
    releasePage();
    const result = await pending;
    expect(result.sourceType).toBe("llms-txt");
    expect(result.url).toBe("https://probe.example.com/llms.txt");
  });

  it("does not hold a ready page for long behind a slow probe", async () => {
    route({
      "https://slowprobe.example.com/docs": () => new Response(prose("Page"), { headers: { "content-type": "text/markdown" } }),
      "https://slowprobe.example.com/llms.txt": () => new Promise<Response>(() => {}),
    });
    const started = Date.now();
    expect((await fetchDocs("https://slowprobe.example.com/docs")).sourceType).toBe("direct");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("fetchDocs cache (NET-05)", () => {
  it("promotes a disk hit with its remaining TTL, not a fresh 30 minutes", async () => {
    await diskDocCache.set("docs:https://ttl.example.com/docs", prose("Disk"), 60_000);
    await fetchDocs("https://ttl.example.com/docs");
    let expiresAt = 0;
    docCache.get("docs:https://ttl.example.com/docs", { maxStaleMs: 0, onHit: (e) => { expiresAt = e; } });
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("serves a day-old entry at once and refreshes it in the background", async () => {
    const docsUrl = "https://swr.example.com/docs";
    await diskDocCache.set(`docs:${docsUrl}`, prose("Yesterday"), -24 * 3_600_000);
    await diskDocCache.set(`docs:${docsUrl}:sourceType`, "direct", -24 * 3_600_000);
    route({ [docsUrl]: () => new Response(prose("Today"), { headers: { "content-type": "text/markdown" } }) });
    const stale = await fetchDocs(docsUrl);
    expect(stale.content).toContain("# Yesterday");
    expect(stale.sourceType).toBe("direct");
    await vi.waitFor(async () => expect((await fetchDocs(docsUrl)).content).toContain("# Today"));
  });
});

describe("fetchDocs oversized llms-full.txt (NET-12)", () => {
  it("answers topic calls from the llms.txt index, other calls from llms-full.txt", async () => {
    const full = "# Full\n\n" + "Section text about every corner of the library. ".repeat(12_000);
    const index = "- [Routing](https://big.example.com/docs/routing)\n".repeat(20);
    route({
      "https://big.example.com/llms-full.txt": () => new Response(full),
      "https://big.example.com/llms.txt": () => new Response(index),
    });
    const args = ["https://big.example.com/docs", "https://big.example.com/llms.txt", "https://big.example.com/llms-full.txt"] as const;
    const topical = await fetchDocs(...args, "routing");
    expect(topical.sourceType).toBe("llms-txt");
    expect(topical.content).toContain("[Routing]");
    expect((await fetchDocs(...args)).sourceType).toBe("llms-full-txt");
    const requests = mockFetch.mock.calls.length;
    expect((await fetchDocs(...args, "routing")).sourceType).toBe("llms-txt");
    expect(mockFetch.mock.calls.length).toBe(requests);
  });
});
