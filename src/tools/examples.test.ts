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

describe("no GT_GITHUB_TOKEN", () => {
  it("skips the guaranteed-401 GitHub call and says so", async () => {
    delete process.env.GT_GITHUB_TOKEN;
    const result = await handler({ library: "react", pattern: "hooks" });
    expect(mockFetchWithTimeout).not.toHaveBeenCalledWith(
      expect.stringContaining("api.github.com/search/code"),
      expect.anything(),
      expect.anything(),
    );
    expect(result.content[0]!.text).toContain("GT_GITHUB_TOKEN");
  });
});

describe("registerExamplesTool", () => {
  it("registers gt_examples tool", () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      "gt_examples",
      expect.anything(),
      expect.any(Function),
    );
  });
});
