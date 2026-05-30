import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock cache so probe calls do not collide across tests. Each cache is its
// own Map — sharing one Map across all caches caused cross-cache collisions.
vi.mock("./cache.js", () => {
  const makeCache = () => {
    const store = new Map<string, unknown>();
    return {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => { store.set(k, v); },
      clear: () => { store.clear(); },
      _store: store,
    };
  };
  return {
    docCache: makeCache(),
    diskDocCache: {
      get: async () => undefined,
      set: async () => {},
      clear: () => {},
    },
    resolveCache: makeCache(),
    llmsProbeCache: makeCache(),
  };
});

// Mock guard so assertPublicUrl does not reject test URLs.
vi.mock("../utils/guard.js", () => ({
  assertPublicUrl: () => {},
}));

import { probeLlmsTxt } from "./resolve.js";
import { fetchWithTimeout } from "./fetcher.js";

vi.mock("./fetcher.js", () => ({
  fetchWithTimeout: vi.fn(async () => ({ ok: false }) as Response),
  fetchNpmPackage: vi.fn(),
  fetchPypiPackage: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  githubAuthHeaders: () => ({}),
}));

const mockedFetch = vi.mocked(fetchWithTimeout);

beforeEach(async () => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue({ ok: false } as Response);
  // Clear llmsProbeCache so each test starts from a clean slate — cache keys
  // are per-origin, so reusing example.com across tests otherwise hits cache.
  const { llmsProbeCache } = await import("./cache.js");
  (llmsProbeCache as { clear: () => void }).clear();
});

describe("probeLlmsTxt — Bug C-3: URL fragment / query normalization", () => {
  it("strips #fragment before concatenating /llms.txt path", async () => {
    await probeLlmsTxt("https://github.com/lyststen/stenly#readme");
    const urls = mockedFetch.mock.calls.map(([u]) => String(u));
    expect(urls).toContain("https://github.com/lyststen/stenly/llms-full.txt");
    expect(urls).toContain("https://github.com/lyststen/stenly/llms.txt");
    for (const u of urls) {
      expect(u).not.toContain("#readme/");
    }
  });

  it("strips ?query before concatenating /llms.txt path", async () => {
    await probeLlmsTxt("https://example.com/docs?utm_source=x");
    const urls = mockedFetch.mock.calls.map(([u]) => String(u));
    for (const u of urls) {
      expect(u).not.toContain("?utm_source=x/");
    }
    expect(urls).toContain("https://example.com/docs/llms.txt");
  });

  it("strips trailing slashes before concatenating", async () => {
    await probeLlmsTxt("https://example.com/docs////");
    const urls = mockedFetch.mock.calls.map(([u]) => String(u));
    expect(urls).toContain("https://example.com/docs/llms.txt");
  });

  it("returns empty result on invalid URL", async () => {
    const result = await probeLlmsTxt("not-a-url");
    expect(result).toEqual({});
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("reports llmsTxtUrl with normalized base when probe succeeds", async () => {
    mockedFetch.mockImplementation(async (url: string) => {
      // Only the llms.txt path returns 200, not llms-full.txt.
      if (url.endsWith("/llms.txt") && !url.endsWith("/llms-full.txt")) {
        return { ok: true } as Response;
      }
      return { ok: false } as Response;
    });
    const result = await probeLlmsTxt("https://example.com/docs#section");
    expect(result.llmsTxtUrl).toBe("https://example.com/docs/llms.txt");
    expect(result.llmsTxtUrl).not.toContain("#section");
  });
});
