import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

const memory = new Map<string, string>();
const disk = new Map<string, string>();
vi.mock("../services/cache.js", () => ({
  docCache: { get: (k: string) => memory.get(k), set: (k: string, v: string) => void memory.set(k, v) },
  diskDocCache: {
    get: async (k: string) => disk.get(k),
    set: async (k: string, v: string) => void disk.set(k, v),
  },
}));
vi.mock("../services/search/collect.js", () => ({ collectSearchSources: vi.fn() }));
vi.mock("../services/search/fetch-topic.js", () => ({ addWebSearchSources: vi.fn(async () => undefined) }));

import { collectSearchSources } from "../services/search/collect.js";
import { registerSearchTool } from "./search.js";

type Result = { content: Array<{ text: string }> };
let handler!: (input: { query: string; tokens: number }) => Promise<Result>;
registerSearchTool({
  registerTool: (_n: string, _c: unknown, h: typeof handler) => {
    handler = h;
  },
} as unknown as McpServer);

const RLS = {
  source: "PostgreSQL",
  url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html",
  content: "## Row Security Policies\nPostgres row level security policies restrict rows. ".repeat(10),
};

beforeEach(() => {
  memory.clear();
  disk.clear();
  vi.mocked(collectSearchSources).mockReset().mockResolvedValue({ results: [RLS], webSearched: false });
});

describe("gt_search — result cache", () => {
  it("answers a repeat of the same query, modulo case and spacing, without sourcing again", async () => {
    const first = await handler({ query: "Postgres row level security", tokens: 8000 });
    const second = await handler({ query: "  postgres   ROW level security ", tokens: 8000 });
    expect(collectSearchSources).toHaveBeenCalledTimes(1);
    expect(second.content[0]!.text).toContain(RLS.url);
    expect(second.content[0]!.text.length).toBeGreaterThan(first.content[0]!.text.length / 2);
  });

  it("serves a new process from the disk copy", async () => {
    await handler({ query: "postgres row level security", tokens: 8000 });
    memory.clear();
    await handler({ query: "postgres row level security", tokens: 8000 });
    expect(collectSearchSources).toHaveBeenCalledTimes(1);
  });

  it("does not remember a query that found nothing", async () => {
    vi.mocked(collectSearchSources).mockResolvedValue({ results: [], webSearched: true });
    await handler({ query: "zzqx unknown", tokens: 8000 });
    await handler({ query: "zzqx unknown", tokens: 8000 });
    expect(collectSearchSources).toHaveBeenCalledTimes(2);
  });

  it("keys on the token budget", async () => {
    await handler({ query: "postgres row level security", tokens: 8000 });
    await handler({ query: "postgres row level security", tokens: 2000 });
    expect(collectSearchSources).toHaveBeenCalledTimes(2);
  });
});
