import { describe, it, expect, vi } from "vitest";

const probeLlmsTxt = vi.hoisted(() => vi.fn(async () => ({ llmsTxtUrl: "https://tailwindcss.com/llms.txt" })));
vi.mock("../resolve.js", () => ({ probeLlmsTxt, resolveDynamic: vi.fn(async () => null) }));

import { resolveBestPracticesTarget } from "./target.js";

describe("resolveBestPracticesTarget", () => {
  it("does not hold the call on an llms probe; fetchDocs runs it beside the page (NET-07)", async () => {
    const target = await resolveBestPracticesTarget("tailwindlabs/tailwindcss");
    expect(probeLlmsTxt).not.toHaveBeenCalled();
    expect(target).toMatchObject({ docsUrl: "https://tailwindcss.com/docs", llmsTxtUrl: undefined, resolvedId: "tailwindlabs/tailwindcss" });
  });
});
