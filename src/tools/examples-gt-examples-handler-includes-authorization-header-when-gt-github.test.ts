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
  it("includes Authorization header when GT_GITHUB_TOKEN is set", async () => {
    vi.mocked(githubAuthHeaders).mockReturnValueOnce({ Authorization: "Bearer ghp_test123" });
    mockFetchWithTimeout.mockResolvedValueOnce(
      makeRes(JSON.stringify({ total_count: 0, items: [] }), 200),
    );
    await handler({ library: "react", maxResults: 5 });
    const headers = mockFetchWithTimeout.mock.calls[0]![2] as Record<string, string>;
    expect(headers).toMatchObject({ Authorization: "Bearer ghp_test123" });
  });

  it("includes language filter in search query", async () => {
    mockFetchWithTimeout.mockResolvedValueOnce(
      makeRes(JSON.stringify({ total_count: 0, items: [] }), 200),
    );
    await handler({ library: "fastapi", language: "python", maxResults: 5 });
    const url = mockFetchWithTimeout.mock.calls[0]![0] as string;
    expect(decodeURIComponent(url)).toContain("language:python");
  });

  it("handles items without text_matches", async () => {
    mockFetchWithTimeout.mockResolvedValueOnce(
      makeRes(
        JSON.stringify({
          total_count: 1,
          items: [
            {
              name: "app.ts",
              path: "src/app.ts",
              html_url: "https://github.com/org/repo/blob/main/src/app.ts",
              repository: {
                full_name: "org/repo",
                html_url: "https://github.com/org/repo",
                stargazers_count: 50,
              },
            },
          ],
        }),
        200,
      ),
    );
    const result = await handler({ library: "test-lib", maxResults: 5 });
    expect(result.content[0]!.text).toContain("org/repo");
    expect(result.content[0]!.text).not.toContain("```");
  });

  it("includes pattern in no-results message", async () => {
    mockFetchWithTimeout.mockResolvedValueOnce(
      makeRes(JSON.stringify({ total_count: 0, items: [] }), 200),
    );
    const result = await handler({ library: "react", pattern: "useMutation", maxResults: 5 });
    expect(result.content[0]!.text).toContain("useMutation");
  });

  it("excludes documentation/markdown files from the code search query", async () => {
    mockFetchWithTimeout.mockResolvedValueOnce(
      makeRes(JSON.stringify({ total_count: 0, items: [] }), 200),
    );
    await handler({ library: "express", pattern: "middleware", maxResults: 5 });
    const url = decodeURIComponent(mockFetchWithTimeout.mock.calls[0]![0] as string);
    expect(url).toContain("-extension:md");
    expect(url).toContain("-extension:rst");
  });
});
