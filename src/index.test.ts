import { describe, it, expect, vi } from "vitest";

// ── Dependency mocks ────────────────────────────────────────────────────────

// Prevent actual stdio connection
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  // Use a regular function (not arrow) so new McpServer() works as a constructor
  McpServer: vi.fn().mockImplementation(function McpServerMock(
    this: { _name: string; _version: string; registerTool: unknown; connect: unknown },
    meta: { name: string; version: string },
  ) {
    this._name = meta.name;
    this._version = meta.version;
    this.registerTool = vi.fn();
    this.connect = vi.fn().mockResolvedValue(undefined);
  }),
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

// ── process.exit guard ──────────────────────────────────────────────────────

// main() runs when index.ts is imported. If server.connect() rejects, the
// .catch() handler calls process.exit(1). Vitest intercepts that call and
// surfaces it as an "Unhandled Error". vi.hoisted() runs BEFORE any imports,
// so the spy is in place before index.ts's module-level code executes.
vi.hoisted(() => {
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as () => never);
});

// ── Imports after mocks ─────────────────────────────────────────────────────

// Import index to trigger bootstrap (all deps are mocked above)
import "./index.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerResolveTool } from "./tools/resolve.js";
import { registerDocsTool } from "./tools/docs.js";
import { registerBestPracticesTool } from "./tools/best-practices.js";
import { registerAutoScanTool } from "./tools/auto-scan.js";
import { registerSearchTool } from "./tools/search.js";
import { registerAuditTool } from "./tools/audit.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("index.ts bootstrap", () => {
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

    it("SERVER_NAME is gt-mcp-server", () => {
      expect(SERVER_NAME).toBe("gt-mcp-server");
    });
  });

  describe("tool registration", () => {
    it("calls registerResolveTool", () => {
      expect(registerResolveTool).toHaveBeenCalledOnce();
    });

    it("calls registerDocsTool", () => {
      expect(registerDocsTool).toHaveBeenCalledOnce();
    });

    it("calls registerBestPracticesTool", () => {
      expect(registerBestPracticesTool).toHaveBeenCalledOnce();
    });

    it("calls registerAutoScanTool", () => {
      expect(registerAutoScanTool).toHaveBeenCalledOnce();
    });

    it("calls registerSearchTool", () => {
      expect(registerSearchTool).toHaveBeenCalledOnce();
    });

    it("calls registerAuditTool", () => {
      expect(registerAuditTool).toHaveBeenCalledOnce();
    });

    it("calls all 6 registration functions", () => {
      const allCalled = [
        registerResolveTool,
        registerDocsTool,
        registerBestPracticesTool,
        registerAutoScanTool,
        registerSearchTool,
        registerAuditTool,
      ].every((fn) => vi.mocked(fn).mock.calls.length > 0);
      expect(allCalled).toBe(true);
    });

    it("passes the McpServer instance to each registration function", () => {
      const serverInstance = vi.mocked(McpServer).mock.results[0]!.value as unknown;
      expect(vi.mocked(registerResolveTool)).toHaveBeenCalledWith(serverInstance);
      expect(vi.mocked(registerDocsTool)).toHaveBeenCalledWith(serverInstance);
      expect(vi.mocked(registerBestPracticesTool)).toHaveBeenCalledWith(serverInstance);
      expect(vi.mocked(registerAutoScanTool)).toHaveBeenCalledWith(serverInstance);
      expect(vi.mocked(registerSearchTool)).toHaveBeenCalledWith(serverInstance);
      expect(vi.mocked(registerAuditTool)).toHaveBeenCalledWith(serverInstance);
    });
  });

  describe("StdioServerTransport", () => {
    it("creates a StdioServerTransport instance", () => {
      expect(StdioServerTransport).toHaveBeenCalled();
    });
  });

  describe("constants", () => {
    it("SERVER_VERSION matches package.json version pattern", () => {
      expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("SERVER_NAME is a non-empty string", () => {
      expect(typeof SERVER_NAME).toBe("string");
      expect(SERVER_NAME.length).toBeGreaterThan(0);
    });
  });
});
