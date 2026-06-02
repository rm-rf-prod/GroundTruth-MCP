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

import { probeLlmsTxt, resolveFromNpm, resolveFromPypi } from "./resolve.js";
import { fetchWithTimeout, fetchNpmPackage, fetchPypiPackage } from "./fetcher.js";

vi.mock("./fetcher.js", () => ({
  fetchWithTimeout: vi.fn(async () => ({ ok: false }) as Response),
  fetchNpmPackage: vi.fn(),
  fetchPypiPackage: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  githubAuthHeaders: () => ({}),
}));

const mockedFetch = vi.mocked(fetchWithTimeout);
const mockedFetchNpm = vi.mocked(fetchNpmPackage);
const mockedFetchPypi = vi.mocked(fetchPypiPackage);

beforeEach(async () => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue({ ok: false } as Response);
  mockedFetchNpm.mockReset();
  mockedFetchPypi.mockReset();
  // Clear llmsProbeCache so each test starts from a clean slate — cache keys
  // are per-origin, so reusing example.com across tests otherwise hits cache.
  const { llmsProbeCache, resolveCache } = await import("./cache.js");
  (llmsProbeCache as { clear: () => void }).clear();
  (resolveCache as { clear: () => void }).clear();
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

// TS-010: resolveFromNpm and resolveFromPypi return null on wrong-shape response
describe("resolveFromNpm — TS-010: wrong-shape response returns null without throwing", () => {
  it("returns null when fetchNpmPackage returns object with no name key", async () => {
    mockedFetchNpm.mockResolvedValue({ wrongField: true } as unknown as null);
    const result = await resolveFromNpm("no-name-pkg");
    expect(result).toBeNull();
  });

  it("returns null when fetchNpmPackage returns object with name as non-string", async () => {
    mockedFetchNpm.mockResolvedValue({ name: 42 } as unknown as null);
    const result = await resolveFromNpm("numeric-name-pkg");
    expect(result).toBeNull();
  });

  it("returns null when fetchNpmPackage returns null", async () => {
    mockedFetchNpm.mockResolvedValue(null);
    const result = await resolveFromNpm("null-pkg");
    expect(result).toBeNull();
  });

  it("does not throw on wrong-shape response", async () => {
    mockedFetchNpm.mockResolvedValue({ wrongField: true } as unknown as null);
    await expect(resolveFromNpm("throw-pkg")).resolves.toBeNull();
  });
});

describe("resolveFromPypi — TS-010: wrong-shape response returns null without throwing", () => {
  it("returns null when fetchPypiPackage returns object with no info key", async () => {
    mockedFetchPypi.mockResolvedValue({ wrongField: true } as unknown as null);
    const result = await resolveFromPypi("no-info-pkg");
    expect(result).toBeNull();
  });

  it("returns null when fetchPypiPackage returns object with info as non-object", async () => {
    mockedFetchPypi.mockResolvedValue({ info: "string-not-object" } as unknown as null);
    const result = await resolveFromPypi("bad-info-pkg");
    expect(result).toBeNull();
  });

  it("returns null when fetchPypiPackage returns object with info as null", async () => {
    mockedFetchPypi.mockResolvedValue({ info: null } as unknown as null);
    const result = await resolveFromPypi("null-info-pkg");
    expect(result).toBeNull();
  });

  it("returns null when fetchPypiPackage returns null", async () => {
    mockedFetchPypi.mockResolvedValue(null);
    const result = await resolveFromPypi("null-pkg");
    expect(result).toBeNull();
  });

  it("does not throw on wrong-shape response", async () => {
    mockedFetchPypi.mockResolvedValue({ wrongField: true } as unknown as null);
    await expect(resolveFromPypi("throw-pkg")).resolves.toBeNull();
  });
});
