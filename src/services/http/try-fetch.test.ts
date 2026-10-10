import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tryFetch, tryFetchPage } from "./try-fetch.js";
import { clearNegativeCache } from "./negative-cache.js";
import { MARKDOWN_ACCEPT } from "./request.js";
import { getCircuitState, resetAllCircuits } from "../circuit-breaker.js";
import { runWithCallSignal } from "../../utils/guard.js";

const mockFetch = vi.fn<typeof fetch>();
const page = "# Docs page\n\n" + "Real documentation text. ".repeat(20);
const res = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });
const acceptOf = (call: number) => (mockFetch.mock.calls[call]?.[1]?.headers as Record<string, string>).Accept;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  clearNegativeCache();
  resetAllCircuits();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tryFetchPage / tryFetch", () => {
  it("asks a docs page for markdown and reports the content type (NET-04)", async () => {
    mockFetch.mockResolvedValueOnce(res(page, 200, { "content-type": "text/markdown; charset=utf-8" }));
    const out = await tryFetchPage("https://md.example.com/docs/a", 0);
    expect(out).toEqual({ text: page, contentType: "text/markdown; charset=utf-8" });
    expect(acceptOf(0)).toBe(MARKDOWN_ACCEPT);
  });

  it("retries a 404 under markdown negotiation as HTML and remembers the host (NET-04)", async () => {
    mockFetch
      .mockResolvedValueOnce(res("not found", 404))
      .mockResolvedValueOnce(res(page, 200, { "content-type": "text/html" }))
      .mockResolvedValueOnce(res(page, 200, { "content-type": "text/html" }));
    expect((await tryFetchPage("https://neg.example.com/", 0))?.text).toBe(page);
    expect(acceptOf(1)).not.toBe(MARKDOWN_ACCEPT);
    expect((await tryFetchPage("https://neg.example.com/docs/b", 0))?.text).toBe(page);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(acceptOf(2)).not.toBe(MARKDOWN_ACCEPT);
  });

  it("still retries as HTML after a real 404 on the same host (NET-04)", async () => {
    // nuxt-like host: a missing page 404s both ways, a real page 404s only under markdown.
    mockFetch.mockImplementation(async (url, init) => {
      const md = (init?.headers as Record<string, string>).Accept === MARKDOWN_ACCEPT;
      return String(url).includes("missing") || md ? res("not found", 404) : res(page, 200, { "content-type": "text/html" });
    });
    expect(await tryFetchPage("https://mixed.example.com/missing", 0)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((await tryFetchPage("https://mixed.example.com/docs/intro", 0))?.text).toBe(page);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // The missing URL itself stays negative-cached: no repeat round trips.
    expect(await tryFetchPage("https://mixed.example.com/missing", 0)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("leaves non-page fetches (APIs, llms.txt) on the plain Accept with no retry", async () => {
    mockFetch.mockResolvedValue(res("not found", 404));
    expect(await tryFetch("https://api.example.com/x", 0)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(acceptOf(0)).not.toBe(MARKDOWN_ACCEPT);
  });

  it("negative-caches a body over the size cap instead of downloading it every call (NET-12)", async () => {
    mockFetch.mockImplementation(async () => res("x", 200, { "content-length": String(6 * 1024 * 1024) }));
    expect(await tryFetch("https://big.example.com/llms-full.txt", 0)).toBeNull();
    expect(await tryFetch("https://big.example.com/llms-full.txt", 0)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not negative-cache a body stream that fails mid-read (NET-12)", async () => {
    const flaky = () => {
      let n = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(c) {
          if (n++ === 0) c.enqueue(new TextEncoder().encode(page));
          else c.error(new Error("ECONNRESET"));
        },
      }), { status: 200 });
    };
    mockFetch.mockResolvedValueOnce(flaky()).mockResolvedValueOnce(res(page));
    expect(await tryFetch("https://flaky.example.com/llms-full.txt", 0)).toBeNull();
    expect(await tryFetch("https://flaky.example.com/llms-full.txt", 0)).toBe(page);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("cancels the unread body of a non-ok response so its timeout timer stops", async () => {
    const cancel = vi.fn(async () => {});
    mockFetch.mockResolvedValue({ ok: false, status: 404, headers: new Headers(), body: { cancel } } as unknown as Response);
    expect(await tryFetch("https://gone.example.com/a", 0)).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("does not count a cancelled tool call against the domain's circuit", async () => {
    mockFetch.mockImplementation((_u, init) => new Promise((_r, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    for (let i = 0; i < 6; i++) {
      const call = new AbortController();
      const pending = runWithCallSignal(call.signal, () => tryFetch("https://healthy.example.com/x", 0));
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(i + 1));
      call.abort();
      expect(await pending).toBeNull();
    }
    expect(getCircuitState("healthy.example.com")).toBe("closed");
  });
});
