import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

vi.mock("../sources/registry.js", () => ({
  lookupById: () => ({
    id: "vercel/next.js",
    name: "Next.js",
    docsUrl: "https://nextjs.org/docs",
    githubUrl: undefined,
  }),
  lookupByAlias: () => undefined,
}));
vi.mock("../services/resolve.js", () => ({ resolveDynamic: async () => null }));
vi.mock("../services/migration-sources.js", () => ({
  fetchVersionGuide: async () => ({ source: "https://nextjs.org/docs/upgrading/version-16", content: "upgrade body" }),
  fetchGitHubMigrationDocs: async () => [],
  fetchConventionalUpgradeDocs: async () => null,
  searchForUpgradeGuide: async () => null,
}));
vi.mock("../utils/extract.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/extract.js")>()),
  extractRelevantContent: (content: string) => ({ text: content, truncated: true }),
}));
vi.mock("../utils/guard.js", () => ({
  isExtractionAttempt: () => false,
  withNotice: (t: string) => t,
  EXTRACTION_REFUSAL: "REFUSED",
  withToolTimeout: async (fn: () => Promise<unknown>) => fn(),
}));

import { registerMigrationTool } from "./migration.js";

type Result = { content: Array<{ text: string }> };
let handler!: (input: { libraryId: string; fromVersion?: string; toVersion?: string; tokens: number }) => Promise<Result>;
registerMigrationTool({
  registerTool: (_n: string, _c: unknown, h: typeof handler) => {
    handler = h;
  },
} as unknown as McpServer);

describe("gt_migration header", () => {
  it("does not ask for versions the caller already gave", async () => {
    const { content } = await handler({ libraryId: "vercel/next.js", fromVersion: "15", toVersion: "16", tokens: 8000 });
    expect(content[0]!.text).not.toContain("fromVersion/toVersion");
  });

  it("suggests a version range when one is missing and relevant sections were cut", async () => {
    const { content } = await handler({ libraryId: "vercel/next.js", toVersion: "16", tokens: 8000 });
    expect(content[0]!.text).toContain("fromVersion/toVersion");
    expect(content[0]!.text).not.toMatch(/increase tokens/i);
  });

  it("separates the header rule from the first section heading", async () => {
    const { content } = await handler({ libraryId: "vercel/next.js", fromVersion: "15", toVersion: "16", tokens: 8000 });
    expect(content[0]!.text).toContain("\n---\n\n## https://nextjs.org/docs/upgrading/version-16");
    expect(content[0]!.text).not.toMatch(/---## /);
  });
});
