import { describe, it, expect, vi } from "vitest";

const probeLlmsTxt = vi.hoisted(() => vi.fn(async () => ({ llmsTxtUrl: "https://tailwindcss.com/llms.txt" })));
vi.mock("../services/resolve.js", () => ({ probeLlmsTxt }));

import { resolveDocsTarget, resolveLibraryFromId } from "./docs-resolve.js";

describe("resolveDocsTarget", () => {
  it("leaves llms discovery to fetchDocs, which runs it beside the page fetch (NET-07)", async () => {
    const entry = resolveLibraryFromId("tailwindlabs/tailwindcss");
    expect(entry?.llmsTxtUrl ?? entry?.llmsFullTxtUrl).toBeUndefined();
    const target = await resolveDocsTarget("tailwindlabs/tailwindcss", entry);
    expect(probeLlmsTxt).not.toHaveBeenCalled();
    expect(target).toMatchObject({ docsUrl: "https://tailwindcss.com/docs", llmsTxtUrl: undefined });
  });
});
