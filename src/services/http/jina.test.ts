import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const cache = vi.hoisted(() => {
  const mem = new Map<string, string>();
  return {
    mem,
    docCache: { get: (k: string) => mem.get(k), set: (k: string, v: string) => void mem.set(k, v) },
    diskDocCache: { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) },
  };
});
vi.mock("../cache.js", () => ({ docCache: cache.docCache, diskDocCache: cache.diskDocCache }));

import { fetchViaJina } from "./jina.js";
import { rememberMissing } from "./negative-cache.js";
import { resetAllCircuits } from "../circuit-breaker.js";

const mockFetch = vi.fn<typeof fetch>();
const body = "# Rendered page\n\n" + "Rendered documentation text. ".repeat(10);
const headersOf = (call: number) => mockFetch.mock.calls[call]?.[1]?.headers as Record<string, string>;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => new Response(body));
  cache.mem.clear();
  cache.diskDocCache.set.mockClear();
  resetAllCircuits();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchViaJina", () => {
  it("sends GT_JINA_API_KEY as a bearer token when set (NET-11)", async () => {
    vi.stubEnv("GT_JINA_API_KEY", "jina_test_key");
    await fetchViaJina("https://example.com/keyed");
    expect(headersOf(0).Authorization).toBe("Bearer jina_test_key");
  });

  it("stays anonymous without a key", async () => {
    vi.stubEnv("GT_JINA_API_KEY", "");
    await fetchViaJina("https://example.com/anon");
    expect(headersOf(0).Authorization).toBeUndefined();
  });

  it("keeps its result in memory only; callers persist it under their own key (NET-02)", async () => {
    expect(await fetchViaJina("https://example.com/once")).toBe(body);
    expect(await fetchViaJina("https://example.com/once")).toContain("Rendered documentation text.");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(cache.diskDocCache.set).not.toHaveBeenCalled();
  });

  it("never renders a URL that just answered 404 (ACC-02)", async () => {
    rememberMissing("https://example.com/dead");
    expect(await fetchViaJina("https://example.com/dead")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
