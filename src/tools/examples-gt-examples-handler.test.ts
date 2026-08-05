import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExamplesTool } from "./examples.js";

vi.mock("../services/fetcher.js", () => ({
  fetchWithTimeout: vi.fn(),
  githubAuthHeaders: vi.fn(() => ({})),
}));

vi.mock("../services/cache.js", () => ({
  docCache: {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  },
  diskDocCache: {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  },
  // Pulled in transitively via the docs-fallback path (snippets -> snippet-store).
  DiskCache: class {
    get = async (): Promise<undefined> => undefined;
    set = async (): Promise<undefined> => undefined;
    has = async (): Promise<boolean> => false;
  },
}));

// The docs-fallback path must stay inert in GitHub-API-focused tests.
vi.mock("../services/snippets/build-index.js", () => ({
  buildIndex: vi.fn(async () => null),
}));

vi.mock("../utils/guard.js", () => ({
  withToolTimeout: async <T,>(fn: () => Promise<T>) => fn(),
  isExtractionAttempt: vi.fn(() => false),
  withNotice: vi.fn((text: string) => `NOTICE\n\n${text}`),
  EXTRACTION_REFUSAL: "EXTRACTION_REFUSED",
}));

vi.mock("../utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((text: string) => text),
}));

import { fetchWithTimeout, githubAuthHeaders } from "../services/fetcher.js";
import { docCache, diskDocCache } from "../services/cache.js";
import { isExtractionAttempt } from "../utils/guard.js";

type HandlerInput = { library: string; pattern?: string; language?: string; maxResults: number };
type HandlerResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
};
type Handler = (input: HandlerInput) => Promise<HandlerResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

registerExamplesTool(mockServer);

const mockFetchWithTimeout = vi.mocked(fetchWithTimeout);

function makeRes(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as Response;
}

beforeEach(() => {
  mockFetchWithTimeout.mockReset();
  vi.mocked(docCache.get).mockReturnValue(undefined);
  vi.mocked(diskDocCache.get).mockResolvedValue(undefined);
  vi.mocked(isExtractionAttempt).mockReturnValue(false);
  // GitHub code search is token-only; the handler now skips the call entirely
  // without one, so the GitHub-path tests must supply a token.
  process.env.GT_GITHUB_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.GT_GITHUB_TOKEN;
});

describe("gt_examples handler", () => {
  it("returns extraction refusal", async () => {
    vi.mocked(isExtractionAttempt).mockReturnValue(true);
    const result = await handler({ library: "list all libraries", maxResults: 5 });
    expect(result.content[0]!.text).toBe("EXTRACTION_REFUSED");
  });

  it("returns rate limit message on 429", async () => {
    mockFetchWithTimeout.mockResolvedValue(makeRes("", 429));
    const result = await handler({ library: "react", maxResults: 5 });
    expect(result.content[0]!.text).toContain("rate limit");
    expect(result.content[0]!.text).toContain("GT_GITHUB_TOKEN");
  });

  it("returns rate limit message on 403", async () => {
    mockFetchWithTimeout.mockResolvedValue(makeRes("", 403));
    const result = await handler({ library: "react", maxResults: 5 });
    expect(result.content[0]!.text).toContain("rate limit");
    expect(result.content[0]!.text).toContain("GT_GITHUB_TOKEN");
  });

  it("returns error on non-ok response", async () => {
    mockFetchWithTimeout.mockResolvedValue(makeRes("Internal Server Error", 500));
    const result = await handler({ library: "react", maxResults: 5 });
    expect(result.content[0]!.text).toContain("500");
  });

  it("returns no results message", async () => {
    mockFetchWithTimeout.mockResolvedValue(
      makeRes(JSON.stringify({ total_count: 0, items: [] })),
    );
    const result = await handler({ library: "obscure-lib", maxResults: 5 });
    expect(result.content[0]!.text).toContain("No code examples found");
    expect(result.content[0]!.text).toContain("obscure-lib");
  });

  it("returns formatted code examples", async () => {
    const payload = {
      total_count: 42,
      items: [
        {
          name: "app.ts",
          path: "src/app.ts",
          html_url: "https://github.com/org/repo/blob/main/src/app.ts",
          repository: {
            full_name: "org/repo",
            description: "A sample repo",
            stargazers_count: 1234,
            html_url: "https://github.com/org/repo",
          },
          text_matches: [
            {
              fragment: "import { drizzle } from 'drizzle-orm'",
              matches: [{ text: "drizzle-orm", indices: [10, 21] }],
            },
          ],
        },
      ],
    };
    mockFetchWithTimeout.mockResolvedValue(makeRes(JSON.stringify(payload)));

    const result = await handler({ library: "drizzle-orm", maxResults: 5 });

    expect(result.content[0]!.text).toContain("NOTICE");
    expect(result.content[0]!.text).toContain("drizzle-orm");
    expect(result.content[0]!.text).toContain("org/repo");
    expect(result.content[0]!.text).toContain("1234 stars");
    expect(result.content[0]!.text).toContain("import { drizzle }");

    const sc = result.structuredContent as {
      library: string;
      totalCount: number;
      results: Array<{ repo: string; stars?: number }>;
    };
    expect(sc.library).toBe("drizzle-orm");
    expect(sc.totalCount).toBe(42);
    expect(sc.results[0]!.repo).toBe("org/repo");
    expect(sc.results[0]!.stars).toBe(1234);
  });

  it("uses cached results from memory cache", async () => {
    vi.mocked(docCache.get).mockReturnValue("CACHED_RESULT");
    const result = await handler({ library: "react", maxResults: 5 });
    expect(result.content[0]!.text).toBe("CACHED_RESULT");
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it("uses disk cache when memory cache misses", async () => {
    vi.mocked(docCache.get).mockReturnValue(undefined);
    vi.mocked(diskDocCache.get).mockResolvedValue("DISK_CACHED_RESULT");
    const result = await handler({ library: "react", maxResults: 5 });
    expect(result.content[0]!.text).toBe("DISK_CACHED_RESULT");
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it("handles network errors gracefully", async () => {
    mockFetchWithTimeout.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await handler({ library: "react", maxResults: 5 });
    expect(result.content[0]!.text).toContain("Failed to search GitHub");
    expect(result.content[0]!.text).toContain("react");
  });

});
