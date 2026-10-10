import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

vi.mock("../services/changelog-sources.js", () => ({
  resolveChangelogTarget: vi.fn(async () => ({
    displayName: "Next.js",
    githubUrl: "https://github.com/vercel/next.js",
    docsUrl: "https://nextjs.org/docs",
  })),
  fetchChangelog: vi.fn(async () => ({ raw: null, sourceUrl: "https://nextjs.org/docs/changelog" })),
}));
vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: () => false,
  withNotice: (t: string) => t,
  EXTRACTION_REFUSAL: "REFUSED",
  withToolTimeout: async (fn: () => Promise<unknown>) => fn(),
}));

import { fetchChangelog } from "../services/changelog-sources.js";
import { docCache } from "../services/cache.js";
import { registerChangelogTool } from "./changelog.js";

type Result = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
let handler!: (input: { libraryId: string; tokens: number }) => Promise<Result>;
registerChangelogTool({
  registerTool: (_n: string, _c: unknown, h: typeof handler) => {
    handler = h;
  },
} as unknown as McpServer);

beforeEach(() => {
  docCache.clear();
  vi.mocked(fetchChangelog).mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("gt_changelog — miss cache", () => {
  it("serves a repeated miss from cache with the same text and a found:false envelope", async () => {
    const first = await handler({ libraryId: "vercel/next.js", tokens: 8000 });
    const second = await handler({ libraryId: "vercel/next.js", tokens: 8000 });
    expect(fetchChangelog).toHaveBeenCalledTimes(1);
    expect(second.content[0]!.text).toBe(first.content[0]!.text);
    expect(first.content[0]!.text).toContain("No changelog found");
    expect(second.structuredContent).toMatchObject({ found: false, displayName: "Next.js", cached: true });
  });

  it("retries a miss once five minutes have passed, despite the serve-stale window", async () => {
    await handler({ libraryId: "vercel/next.js", tokens: 8000 });
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await handler({ libraryId: "vercel/next.js", tokens: 8000 });
    expect(fetchChangelog).toHaveBeenCalledTimes(2);
  });
});
