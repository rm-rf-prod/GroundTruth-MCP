import { describe, it, expect, vi } from "vitest";

// ── Dependency mocks ────────────────────────────────────────────────────────

// Prevent actual stdio connection
vi.mock("@modelcontextprotocol/server/stdio", () => ({
  // Regular function (not arrow) so new StdioServerTransport() works as a constructor
  StdioServerTransport: vi.fn().mockImplementation(function StdioServerTransportMock() { return {}; }),
  serveStdio: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("@modelcontextprotocol/server", () => ({
  // Use a regular function (not arrow) so new McpServer() works as a constructor
  McpServer: vi.fn().mockImplementation(function McpServerMock(
    this: { _name: string; _version: string; registerTool: unknown; registerResource: unknown; registerPrompt: unknown; connect: unknown },
    meta: { name: string; version: string },
  ) {
    this._name = meta.name;
    this._version = meta.version;
    this.registerTool = vi.fn();
    this.registerResource = vi.fn();
    this.registerPrompt = vi.fn();
    this.connect = vi.fn().mockResolvedValue(undefined);
  }),
  ResourceTemplate: class { constructor() { /* mock */ } },
}));

vi.mock("./tools/resolve.js", () => ({
  registerResolveTool: vi.fn(),
}));
vi.mock("./tools/docs.js", () => ({
  registerDocsTool: vi.fn(),
}));
vi.mock("./tools/best-practices.js", () => ({
  registerBestPracticesTool: vi.fn(),
}));
vi.mock("./tools/auto-scan.js", () => ({
  registerAutoScanTool: vi.fn(),
}));
vi.mock("./tools/search.js", () => ({
  registerSearchTool: vi.fn(),
}));
vi.mock("./tools/audit.js", () => ({
  registerAuditTool: vi.fn(),
}));
vi.mock("./tools/changelog.js", () => ({
  registerChangelogTool: vi.fn(),
}));
vi.mock("./tools/compat.js", () => ({
  registerCompatTool: vi.fn(),
}));
vi.mock("./tools/compare.js", () => ({
  registerCompareTool: vi.fn(),
}));
vi.mock("./tools/examples.js", () => ({
  registerExamplesTool: vi.fn(),
}));
vi.mock("./tools/migration.js", () => ({
  registerMigrationTool: vi.fn(),
}));
vi.mock("./tools/batch-resolve.js", () => ({
  registerBatchResolveTool: vi.fn(),
}));

vi.mock("./sources/registry.js", () => ({
  LIBRARY_REGISTRY: [{ id: "test/lib", name: "TestLib", docsUrl: "https://example.com" }],
}));

vi.mock("./services/fetcher.js", () => ({
  fetchDocs: vi.fn().mockResolvedValue({ content: "docs", url: "https://example.com", sourceType: "direct" }),
}));

vi.mock("./utils/extract.js", () => ({
  extractRelevantContent: vi.fn((content: string) => ({ text: content, truncated: false })),
}));

vi.mock("./utils/sanitize.js", () => ({
  sanitizeContent: vi.fn((content: string) => content),
}));

vi.mock("./utils/guard.js", () => ({
  withNotice: vi.fn((text: string) => text),
}));

// ── process.exit guard ──────────────────────────────────────────────────────

// main() runs when server/main.ts is imported. If server.connect() rejects, the
// .catch() handler calls process.exit(1). Vitest intercepts that call and
// surfaces it as an "Unhandled Error". vi.hoisted() runs BEFORE any imports,
// so the spy is in place before main.ts's module-level code executes.
vi.hoisted(() => {
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as () => never);
});

// ── Imports after mocks ─────────────────────────────────────────────────────

// Import the server entry to trigger bootstrap (all deps are mocked above).
// Not ./index.js: that bootstrap routes on process.argv and enables the compile cache.
import "./server/main.js";

import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { registerResolveTool } from "./tools/resolve.js";
import { registerDocsTool } from "./tools/docs.js";
import { registerBestPracticesTool } from "./tools/best-practices.js";
import { registerAutoScanTool } from "./tools/auto-scan.js";
import { registerSearchTool } from "./tools/search.js";
import { registerAuditTool } from "./tools/audit.js";
import { registerChangelogTool } from "./tools/changelog.js";
import { registerCompatTool } from "./tools/compat.js";
import { registerCompareTool } from "./tools/compare.js";
import { registerExamplesTool } from "./tools/examples.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("server/main.ts bootstrap", () => {
  describe("McpServer instantiation", () => {
    it("creates McpServer with correct server name", () => {
      expect(McpServer).toHaveBeenCalledWith(
        expect.objectContaining({ name: SERVER_NAME }),
        expect.anything(),
      );
    });

    it("creates McpServer with correct server version", () => {
      expect(McpServer).toHaveBeenCalledWith(
        expect.objectContaining({ version: SERVER_VERSION }),
        expect.anything(),
      );
    });

    it("includes server instructions in McpServer config", () => {
      const call = vi.mocked(McpServer).mock.calls[0];
      expect(call?.[1]).toHaveProperty("instructions");
    });

    it("SERVER_NAME is GroundTruth", () => {
      expect(SERVER_NAME).toBe("GroundTruth");
    });

    it("advertises title and websiteUrl in serverInfo", () => {
      expect(McpServer).toHaveBeenCalledWith(
        expect.objectContaining({ title: "GroundTruth", websiteUrl: "https://github.com/rm-rf-prod/GroundTruth-MCP" }),
        expect.anything(),
      );
    });

    it("sets a tools/list cache hint", () => {
      const options = vi.mocked(McpServer).mock.calls[0]?.[1];
      expect(options?.cacheHints?.["tools/list"]).toEqual({ ttlMs: 3_600_000, cacheScope: "public" });
    });
  });

  describe("stdio serving", () => {
    it("passes the constructed StdioServerTransport to serveStdio", () => {
      const options = vi.mocked(serveStdio).mock.calls[0]?.[1];
      expect(options?.transport).toBe(vi.mocked(StdioServerTransport).mock.results[0]?.value);
    });

    it("hands the import-time server to the first connection, then builds fresh ones", () => {
      const factory = vi.mocked(serveStdio).mock.calls[0]![0];
      const eager = vi.mocked(McpServer).mock.results[0]?.value;
      expect(factory({ era: "legacy" })).toBe(eager);
      expect(factory({ era: "legacy" })).not.toBe(eager);
      expect(McpServer).toHaveBeenCalledTimes(2);
    });
  });
});
