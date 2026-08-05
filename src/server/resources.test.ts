import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(async () => ({ content: "# Zod\n\nSchema validation.", url: "https://zod.dev", sourceType: "direct" })),
}));

vi.mock("../utils/guard.js", () => ({
  withNotice: (text: string) => text,
}));

import { registerResources } from "./resources.js";

type ReadHandler = (
  uri: URL,
  vars: Record<string, string | string[]>,
) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>;

function capture(): { templates: string[]; handlers: Map<string, ReadHandler> } {
  const templates: string[] = [];
  const handlers = new Map<string, ReadHandler>();
  const server = {
    registerResource: vi.fn((name: string, uriOrTemplate: unknown, _cfg: unknown, handler: ReadHandler) => {
      const template = typeof uriOrTemplate === "string"
        ? uriOrTemplate
        : (uriOrTemplate as { uriTemplate: { toString(): string } }).uriTemplate.toString();
      templates.push(template);
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;
  registerResources(server);
  return { templates, handlers };
}

describe("MCP resources", () => {
  it("registers the registry and docs resources", () => {
    const { templates } = capture();
    expect(templates).toContain("gt://registry");
    expect(templates.some((t) => t.startsWith("gt://docs/"))).toBe(true);
  });

  /**
   * Every registry ID is "owner/name". A plain {libraryId} is RFC 6570 simple
   * expansion, which stops at "/" — so gt://docs/facebook/react never matched
   * the template and every registry ID was unreadable. Reserved expansion
   * ({+libraryId}) is what makes the resource usable at all.
   */
  it("uses reserved expansion so slashed registry IDs match the template", () => {
    const { templates } = capture();
    expect(templates).toContain("gt://docs/{+libraryId}");
  });

  it("serves docs for a slashed registry ID", async () => {
    const { handlers } = capture();
    const handler = handlers.get("library-docs")!;
    const result = await handler(new URL("gt://docs/colinhacks/zod"), { libraryId: "colinhacks/zod" });
    expect(result.contents[0]!.mimeType).toBe("text/markdown");
    expect(result.contents[0]!.text).toContain("Zod");
  });

  it("serves docs for a bare alias", async () => {
    const { handlers } = capture();
    const handler = handlers.get("library-docs")!;
    const result = await handler(new URL("gt://docs/zod"), { libraryId: "zod" });
    expect(result.contents[0]!.text).toContain("Zod");
  });

  it("reports an unknown library instead of throwing", async () => {
    const { handlers } = capture();
    const handler = handlers.get("library-docs")!;
    const result = await handler(new URL("gt://docs/not-a-real-lib"), { libraryId: "not-a-real-lib" });
    expect(result.contents[0]!.text).toContain("Library not found");
  });
});
