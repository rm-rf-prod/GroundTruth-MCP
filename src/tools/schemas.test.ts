import { describe, it, expect } from "vitest";
import { z } from "zod";
import { registerResolveTool } from "./resolve.js";
import { registerDocsTool } from "./docs.js";
import { registerBestPracticesTool } from "./best-practices.js";
import { registerAutoScanTool } from "./auto-scan.js";
import { registerSearchTool } from "./search.js";
import { registerAuditTool } from "./audit.js";
import { registerChangelogTool } from "./changelog.js";
import { registerCompatTool } from "./compat.js";
import { registerCompareTool } from "./compare.js";
import { registerExamplesTool } from "./examples.js";
import { registerMigrationTool } from "./migration.js";
import { registerBatchResolveTool } from "./batch-resolve.js";
import { registerSnippetsTool } from "./snippets.js";
import { registerDispatchTool } from "./dispatch.js";

interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny | Record<string, z.ZodTypeAny>;
  annotations?: Record<string, boolean>;
}

interface MockServer {
  tools: Map<string, ToolRegistration>;
  registerTool(
    name: string,
    config: {
      title?: string;
      description: string;
      inputSchema: z.ZodTypeAny | Record<string, z.ZodTypeAny>;
      annotations?: Record<string, boolean>;
    },
    _handler: unknown,
  ): void;
}

function createMockServer(): MockServer {
  return {
    tools: new Map(),
    registerTool(name, config, _handler) {
      this.tools.set(name, {
        name,
        description: config.description,
        inputSchema: config.inputSchema,
        annotations: config.annotations,
      });
    },
  };
}

describe("MCP tool schemas", () => {
  const server = createMockServer();
  // @ts-expect-error — mock server matches the surface area we use
  registerResolveTool(server);
  // @ts-expect-error — mock server
  registerDocsTool(server);
  // @ts-expect-error — mock server
  registerBestPracticesTool(server);
  // @ts-expect-error — mock server
  registerAutoScanTool(server);
  // @ts-expect-error — mock server
  registerSearchTool(server);
  // @ts-expect-error — mock server
  registerAuditTool(server);
  // @ts-expect-error — mock server
  registerChangelogTool(server);
  // @ts-expect-error — mock server
  registerCompatTool(server);
  // @ts-expect-error — mock server
  registerCompareTool(server);
  // @ts-expect-error — mock server
  registerExamplesTool(server);
  // @ts-expect-error — mock server
  registerMigrationTool(server);
  // @ts-expect-error — mock server
  registerBatchResolveTool(server);
  // @ts-expect-error — mock server
  registerSnippetsTool(server);
  // @ts-expect-error — mock server
  registerDispatchTool(server);

  it("registers exactly 14 tools", () => {
    expect(server.tools.size).toBe(14);
  });

  it("every tool name starts with gt_", () => {
    for (const name of server.tools.keys()) {
      expect(name.startsWith("gt_")).toBe(true);
    }
  });

  it("every tool has a non-empty description", () => {
    for (const [name, tool] of server.tools) {
      expect(tool.description.length, `${name} description`).toBeGreaterThan(20);
    }
  });

  it("every tool exposes annotations with readOnlyHint=true and destructiveHint=false", () => {
    for (const [name, tool] of server.tools) {
      expect(tool.annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(true);
      expect(tool.annotations?.destructiveHint, `${name} destructiveHint`).toBe(false);
    }
  });

  it("exact tool name set is stable (snapshot)", () => {
    const names = [...server.tools.keys()].sort();
    expect(names).toMatchSnapshot();
  });

  it("input schema shapes are stable (snapshot)", () => {
    const shapes: Record<string, string[]> = {};
    for (const [name, tool] of server.tools) {
      const schema = tool.inputSchema;
      // Tools register input shape either as a ZodObject or a raw shape map
      if (schema instanceof z.ZodObject) {
        shapes[name] = Object.keys(schema.shape as Record<string, unknown>).sort();
      } else if (typeof schema === "object" && schema !== null) {
        shapes[name] = Object.keys(schema).sort();
      } else {
        shapes[name] = [];
      }
    }
    expect(shapes).toMatchSnapshot();
  });
});
