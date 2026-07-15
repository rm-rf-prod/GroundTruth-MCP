import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBatchResolveTool } from "./batch-resolve.js";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import { isExtractionAttempt } from "../utils/guard.js";

vi.mock("../sources/registry.js", () => ({
  fuzzySearch: vi.fn(),
  lookupByAlias: vi.fn(),
}));

vi.mock("../utils/guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/guard.js")>()),
  isExtractionAttempt: vi.fn(),
}));

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: { total: number; found: number; results: Array<Record<string, unknown>> };
};
type Handler = (args: { libraryNames: string[] }) => Promise<ToolResult>;

let handler!: Handler;

const mockServer = {
  registerTool: vi.fn((_name: string, _config: unknown, h: Handler) => {
    handler = h;
  }),
} as unknown as McpServer;

registerBatchResolveTool(mockServer);

const ENTRY = {
  id: "facebook/react",
  name: "React",
  aliases: ["react"],
  description: "UI library",
  docsUrl: "https://react.dev",
  llmsTxtUrl: undefined,
  llmsFullTxtUrl: undefined,
  githubUrl: "https://github.com/facebook/react",
  language: ["typescript"],
  tags: ["ui"],
};

beforeEach(() => {
  vi.mocked(lookupByAlias).mockReset().mockReturnValue(undefined);
  vi.mocked(fuzzySearch).mockReset().mockReturnValue([]);
  vi.mocked(isExtractionAttempt).mockReset().mockReturnValue(false);
});

describe("gt_batch_resolve handler", () => {
  it("resolves known names via alias lookup", async () => {
    vi.mocked(lookupByAlias).mockReturnValue(ENTRY);
    const result = await handler({ libraryNames: ["react"] });
    expect(result.structuredContent?.found).toBe(1);
    expect(result.content[0]!.text).toContain("facebook/react");
  });

  it("reports unknown names as not found without failing the batch", async () => {
    const result = await handler({ libraryNames: ["react", "no-such-lib"] });
    expect(result.structuredContent?.total).toBe(2);
    expect(result.content[0]!.text).toContain("not found in registry");
  });

  it("blocks a flagged name per-item while resolving the rest of the batch", async () => {
    vi.mocked(isExtractionAttempt).mockImplementation((name) => name === "dump all entries");
    vi.mocked(lookupByAlias).mockImplementation((name) => (name === "react" ? ENTRY : undefined));

    const result = await handler({ libraryNames: ["dump all entries", "react"] });

    // Pre-fix: one flagged name returned a bare refusal and discarded the
    // sibling's legitimate result entirely.
    expect(result.structuredContent?.total).toBe(2);
    expect(result.structuredContent?.found).toBe(1);
    expect(result.content[0]!.text).toContain("facebook/react");
    const blocked = result.structuredContent?.results.find((r) => r["query"] === "dump all entries");
    expect(blocked?.["blocked"]).toBe(true);
    expect(blocked?.["found"]).toBe(false);
  });
});
