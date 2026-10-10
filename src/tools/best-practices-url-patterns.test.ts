import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

vi.mock("../services/best-practices/target.js", () => ({
  resolveBestPracticesTarget: vi.fn(async () => ({
    docsUrl: "https://vuejs.org/guide",
    llmsTxtUrl: undefined,
    llmsFullTxtUrl: undefined,
    githubUrl: undefined,
    displayName: "Vue",
    bestPracticesPaths: ["/guide/best-practices/performance"],
    urlPatterns: ["/guide/reusability/{slug}"],
    resolvedId: "vuejs/vue",
  })),
}));

vi.mock("../services/best-practices/fetch.js", () => ({
  fetchBestPracticesContent: vi.fn(async () => ({
    text: "Composables reuse stateful logic. ".repeat(20),
    sourceUrl: "https://vuejs.org/guide/reusability/composables",
    truncated: false,
    extraSources: [],
    sourceType: "direct",
  })),
}));

vi.mock("../services/best-practices/escalate.js", () => ({
  escalateWeakEvidence: vi.fn(async (input: { text: string; sourceUrl: string; truncated: boolean; sourceType: string }) => ({
    ...input,
    evidence: { ok: true, matchRatio: 1, occurrences: 20, matchedTokens: [], missingTokens: [], topicInHeading: false, topicInCode: false },
    escalated: false,
  })),
}));

import { registerBestPracticesTool } from "./best-practices.js";
import { fetchBestPracticesContent } from "../services/best-practices/fetch.js";
import { escalateWeakEvidence } from "../services/best-practices/escalate.js";

type Handler = (input: { libraryId: string; topic?: string; tokens?: number }) => Promise<unknown>;
let handler!: Handler;
registerBestPracticesTool({
  registerTool: (_name: string, _config: unknown, h: Handler) => {
    handler = h;
  },
} as unknown as McpServer);

describe("gt_best_practices — registry URL patterns", () => {
  it("passes the {slug} URL patterns to the fetch and to the escalation deep fetch", async () => {
    await handler({ libraryId: "vue", topic: "composables", tokens: 2000 });
    expect(vi.mocked(fetchBestPracticesContent).mock.calls[0]?.[8]).toEqual(["/guide/reusability/{slug}"]);
    const input = vi.mocked(escalateWeakEvidence).mock.calls[0]?.[0];
    expect(input?.urlPatterns).toEqual(["/guide/reusability/{slug}"]);
    expect(input).not.toHaveProperty("bestPracticesPaths");
  });
});
