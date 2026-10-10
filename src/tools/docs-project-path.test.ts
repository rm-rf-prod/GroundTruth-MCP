import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

vi.mock("../utils/lockfile.js", () => ({ detectVersionFromLockfile: vi.fn(async () => null) }));
vi.mock("./docs-resolve.js", () => ({
  resolveLibraryFromId: () => ({ id: "facebook/react", name: "React", npmPackage: "react", docsUrl: "https://react.dev" }),
  resolveDocsTarget: async () => "stop here",
}));

import { detectVersionFromLockfile } from "../utils/lockfile.js";
import { registerDocsTool } from "./docs.js";

let handler!: (input: { libraryId: string; projectPath?: string; tokens: number }) => Promise<unknown>;
registerDocsTool({
  registerTool: (_n: string, _c: unknown, h: typeof handler) => {
    handler = h;
  },
} as unknown as McpServer);

describe("gt_get_docs — projectPath", () => {
  it("never reads a lockfile under a blocked system path", async () => {
    await handler({ libraryId: "react", projectPath: "/etc", tokens: 8000 });
    expect(detectVersionFromLockfile).not.toHaveBeenCalled();
  });

  it("reads the lockfile of an ordinary project path, resolved", async () => {
    await handler({ libraryId: "react", projectPath: "/tmp/app/../app", tokens: 8000 });
    expect(detectVersionFromLockfile).toHaveBeenCalledWith("/tmp/app", "react");
  });
});
