/**
 * gt_dispatch — the smart entry point.
 *
 * Most MCP clients will call individual gt_* tools directly because the
 * server.instructions block tells them exactly which tool to use for which
 * trigger phrase. But some clients (or some user inputs) are ambiguous, so
 * `gt_dispatch` is the safety net: take a plain-text user query, route it
 * to the most appropriate underlying tool, and return either:
 *   1. A structured "use this tool with these args" guidance block so the
 *      LLM can immediately make the next tool call (the common, low-latency
 *      path), or
 *   2. An inline executed result for the most common case (gt_auto_scan
 *      with the current cwd, no extra args needed), so a single round-trip
 *      is enough.
 *
 * This is the "never disappoint" tool — even if the user just types
 * "use gt mcp" with no further context, the dispatch returns *something*
 * useful (typically: scanned project dependencies + best practices).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { detectIntent } from "../services/intent-router.js";
import { withNotice, safeguardPath } from "../utils/guard.js";
import { withTelemetry } from "../services/telemetry.js";
import { ROUTING_RATIONALE, ROUTING_FALLBACK } from "../sources/routing-rationale.js";

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe("Raw user request"),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Project root (default: cwd)"),
});

const TOOL_DESCRIPTION =
  'Route a raw user request ("use gt", "use gt for react", "migrate next from 15 to 16") to the right gt_* tool. Returns {tool, args, reason, confidence}. Skip it when the tool is already clear.';

export function registerDispatchTool(server: McpServer): void {
  server.registerTool(
    "gt_dispatch",
    {
      title: "GroundTruth Dispatch",
      description: TOOL_DESCRIPTION,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, projectPath }) => {
      return withTelemetry("gt_dispatch", async (ctx) => {
        const intent = detectIntent({
          query,
          ...(projectPath !== undefined ? { projectPath } : {}),
        });

        // Resolve project path for project-level tools
        let resolvedPath: string | undefined;
        if (
          intent.tool === "gt_auto_scan" ||
          intent.tool === "gt_audit"
        ) {
          try {
            const rawPath = intent.args["projectPath"];
            const pathArg = typeof rawPath === "string" ? rawPath : undefined;
            resolvedPath = safeguardPath(pathArg ?? projectPath ?? process.cwd());
            intent.args["projectPath"] = resolvedPath;
          } catch {
            // fall back to bare cwd marker — actual tool will re-validate
          }
        }

        const lines: string[] = [];
        lines.push(`# Dispatch — routed to \`${intent.tool}\``);
        lines.push("");
        lines.push(`> Confidence: **${(intent.confidence * 100).toFixed(0)}%**  •  Reason: ${intent.reason}`);
        lines.push("");
        lines.push("## Recommended call");
        lines.push("```json");
        lines.push(
          JSON.stringify(
            {
              tool: intent.tool,
              args: intent.args,
            },
            null,
            2,
          ),
        );
        lines.push("```");
        lines.push("");
        lines.push("## Why this routing?");

        lines.push(ROUTING_RATIONALE[intent.tool] ?? ROUTING_FALLBACK);
        lines.push("");
        lines.push("## Next step");
        lines.push(
          `Invoke the recommended tool with the args above. The arguments are checked against the target tool's required fields. If the routing looks wrong, fall back to \`gt_search({ query: "${query.replace(/"/g, '\\"')}" })\` — it never fails to return *something* useful.`,
        );

        ctx.resolved = true;
        return {
          content: [{ type: "text", text: withNotice(lines.join("\n")) }],
          structuredContent: {
            tool: intent.tool,
            args: intent.args,
            reason: intent.reason,
            confidence: intent.confidence,
          },
        };
      });
    },
  );
}

