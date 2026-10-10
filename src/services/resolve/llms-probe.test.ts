import { describe, it, expect, beforeEach, vi } from "vitest";

const { mem, disk } = vi.hoisted(() => ({ mem: new Map<string, unknown>(), disk: new Map<string, string>() }));

vi.mock("../cache.js", () => ({
  llmsProbeCache: { get: (k: string) => mem.get(k), set: (k: string, v: unknown) => { mem.set(k, v); } },
  diskDocCache: {
    get: async (k: string) => disk.get(k),
    set: async (k: string, v: string) => { disk.set(k, v); },
  },
}));
vi.mock("../../utils/guard.js", async (orig) => ({ ...(await orig<object>()), assertPublicUrl: () => {} }));
vi.mock("../fetcher.js", () => ({ fetchWithTimeout: vi.fn() }));

import { probeLlmsTxt } from "./llms-probe.js";
import { fetchWithTimeout } from "../fetcher.js";
import { clearNegativeCache, isKnownMissing } from "../http/negative-cache.js";
import { currentCallSignal, runWithCallSignal } from "../../utils/guard.js";

const mockedFetch = vi.mocked(fetchWithTimeout);
const cancel = vi.fn(async () => {});
function res(status: number, contentType = "text/plain"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    body: { cancel },
  } as unknown as Response;
}
const requested = (): string[] => mockedFetch.mock.calls.map(([u]) => String(u));

beforeEach(() => {
  mem.clear();
  disk.clear();
  clearNegativeCache();
  cancel.mockClear();
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(res(404));
});

describe("probeLlmsTxt (NET-07)", () => {
  it("never builds ${docsUrl}/docs/llms.txt and probes the origin spots instead", async () => {
    await probeLlmsTxt("https://tailwindcss.com/docs");
    const urls = requested();
    expect(urls.some((u) => u.includes("/docs/docs/"))).toBe(false);
    expect(urls).toContain("https://tailwindcss.com/docs/llms.txt");
    expect(urls).toContain("https://tailwindcss.com/llms.txt");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("persists negative results to disk so a new process does not re-probe", async () => {
    await probeLlmsTxt("https://example.com/guide");
    const first = mockedFetch.mock.calls.length;
    mem.clear();
    const again = await probeLlmsTxt("https://example.com/guide");
    expect(again).toEqual({});
    expect(mockedFetch.mock.calls.length).toBe(first);
  });

  it("serves a positive disk hit", async () => {
    disk.set("llms-probe:https://example.com/guide", JSON.stringify({ llmsTxtUrl: "https://example.com/llms.txt" }));
    const r = await probeLlmsTxt("https://example.com/guide");
    expect(r.llmsTxtUrl).toBe("https://example.com/llms.txt");
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("feeds 404s to the shared negative cache and cancels every body", async () => {
    await probeLlmsTxt("https://example.com/guide");
    expect(isKnownMissing("https://example.com/llms.txt")).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(mockedFetch.mock.calls.length);
  });

  it("prefers the docs-scoped file over the origin one", async () => {
    mockedFetch.mockImplementation(async (u: string) =>
      u === "https://example.com/guide/llms.txt" || u === "https://example.com/llms.txt" ? res(200) : res(404));
    const r = await probeLlmsTxt("https://example.com/guide");
    expect(r.llmsTxtUrl).toBe("https://example.com/guide/llms.txt");
  });

  it("rejects an HTML page reached by redirect (not an llms.txt)", async () => {
    mockedFetch.mockResolvedValue(res(200, "text/html; charset=utf-8"));
    expect(await probeLlmsTxt("https://www.radix-ui.com/primitives/docs/components/progress")).toEqual({});
  });
});

describe("probeLlmsTxt on github.com (TOK-2)", () => {
  it("never probes github.com: a repo has no llms.txt and the root one is GitHub's own", async () => {
    expect(await probeLlmsTxt("https://github.com/panva/jose#readme")).toEqual({});
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("probeLlmsTxt keeps transient failures out of the disk cache", () => {
  it.each([
    ["offline", () => Promise.reject(new TypeError("fetch failed"))],
    ["503", () => Promise.resolve(res(503))],
    ["429", () => Promise.resolve(res(429))],
    ["403", () => Promise.resolve(res(403))],
  ])("does not persist an empty result when probes are %s", async (_label, impl) => {
    mockedFetch.mockImplementation(impl);
    expect(await probeLlmsTxt("https://svelte.dev/docs/kit")).toEqual({});
    expect(disk.size).toBe(0);
  });

  it("does not persist an origin hit when a docs-scoped probe was indeterminate", async () => {
    mockedFetch.mockImplementation(async (u: string) =>
      u === "https://example.com/llms.txt" ? res(200) : u.startsWith("https://example.com/guide/") ? res(503) : res(404));
    expect((await probeLlmsTxt("https://example.com/guide")).llmsTxtUrl).toBe("https://example.com/llms.txt");
    expect(disk.size).toBe(0);
  });

  it("persists a docs-scoped hit even when a lower-priority probe failed", async () => {
    mockedFetch.mockImplementation(async (u: string) =>
      u.startsWith("https://example.com/guide/") ? res(200) : res(503));
    await probeLlmsTxt("https://example.com/guide");
    expect(disk.get("llms-probe:https://example.com/guide")).toContain("https://example.com/guide/llms.txt");
  });
});

describe("probeLlmsTxt under a cancelled tool call", () => {
  it("finishes detached, so a cancel never caches an empty answer", async () => {
    mockedFetch.mockImplementation((u: string) => new Promise<Response>((resolve, reject) => {
      const signal = currentCallSignal();
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      setTimeout(() => resolve(u === "https://example.com/guide/llms.txt" ? res(200) : res(404)), 300);
    }));
    const call = new AbortController();
    const pending = runWithCallSignal(call.signal, () => probeLlmsTxt("https://example.com/guide"));
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    call.abort();
    await pending;
    expect(mem.get("llms-probe:https://example.com/guide")).toEqual({ llmsTxtUrl: "https://example.com/guide/llms.txt" });
  });
});
