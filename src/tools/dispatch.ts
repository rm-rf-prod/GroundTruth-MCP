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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectIntent, renderRoutingTable } from "../services/intent-router.js";
import { withNotice, safeguardPath } from "../utils/guard.js";
import { withTelemetry } from "../services/telemetry.js";

const InputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "Plain-text user intent. Examples: 'use gt for react', 'find issues', 'migrate next from 14 to 15', 'best practices for fastapi'.",
    ),
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Optional project directory for project-level intents (auto-scan, audit). Defaults to current working directory.",
    ),
});

const TOOL_DESCRIPTION = `Routes a plain-text user query to the correct gt_* tool with the right arguments. Examples: "use gt", "use gt for react", "find issues in this codebase", "migrate next from 14 to 15".

WHEN TO USE: the user's intent is ambiguous, they invoked gt without specifying a tool ("use gt mcp"), or you want a single entry point that always returns something actionable.

WHEN NOT TO USE: you already know which gt_* tool fits. Call it directly to save one round-trip.

OUTPUT: a routing decision with tool name, args, reason, and a 0-to-1 confidence score. The response text also embeds the routing table and a recommended JSON call so you can make the next tool call without another lookup.

Use it for "use gt mcp" in any phrasing.`;

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
            resolvedPath = safeguardPath((intent.args["projectPath"] as string) ?? projectPath ?? process.cwd());
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

        switch (intent.tool) {
          case "gt_auto_scan":
            lines.push(
              "Your message looks like a project-wide invocation (no specific library named). `gt_auto_scan` walks the dependency manifests in the given project path and fetches the latest best practices for every detected library in one round-trip.",
            );
            break;
          case "gt_best_practices":
            lines.push(
              "You named a specific library, so `gt_best_practices` is the lowest-friction tool — it returns current production patterns, performance, security, and testing guidance for that one library.",
            );
            break;
          case "gt_get_docs":
            lines.push(
              "You provided either a URL or asked for direct docs. `gt_get_docs` fetches the raw library documentation, optionally filtered by topic. It chains after `gt_resolve_library` if needed.",
            );
            break;
          case "gt_audit":
            lines.push(
              "You asked for code-level issues. `gt_audit` scans the project source tree against 18+ issue categories (security, performance, accessibility, etc.) and returns each finding with a live, official-doc-sourced fix.",
            );
            break;
          case "gt_migration":
            lines.push(
              "You mentioned an upgrade or migration. `gt_migration` pulls the official migration guide plus breaking-change list for the named library, scoped by version range when supplied.",
            );
            break;
          case "gt_changelog":
            lines.push(
              "You asked for what's new / release notes. `gt_changelog` reads GitHub Releases first, then CHANGELOG.md, then the docs site for the most recent entries.",
            );
            break;
          case "gt_compare":
            lines.push(
              "Two or more libraries detected. `gt_compare` fetches each one's docs and presents them side-by-side scoped by criteria such as performance, TypeScript support, or bundle size.",
            );
            break;
          case "gt_compat":
            lines.push(
              "You're asking about browser / runtime compatibility. `gt_compat` merges MDN and caniuse data for the feature you named.",
            );
            break;
          case "gt_examples":
            lines.push(
              "You want real-world code. `gt_examples` searches public GitHub for usage of the library/pattern you named and returns the highest-quality snippets.",
            );
            break;
          case "gt_search":
            lines.push(
              "No specific library or scope detected. `gt_search` is the catch-all: any topic, any web standard, any best-practice page.",
            );
            break;
          case "gt_resolve_library":
            lines.push(
              "Resolution-only intent detected. `gt_resolve_library` confirms the library exists and returns the canonical ID + docs URL — call `gt_best_practices` or `gt_get_docs` next.",
            );
            break;
          case "gt_snippets":
            lines.push(
              "You asked for ranked code snippets. `gt_snippets` builds a Context7-compatible snippet index per library + version with disk caching.",
            );
            break;
          case "gt_batch_resolve":
            lines.push(
              "Multi-library lookup detected. `gt_batch_resolve` resolves up to 20 names in a single call.",
            );
            break;
          default:
            lines.push("Routing fallback — call the recommended tool above.");
            break;
        }

        lines.push("");
        lines.push("## Next step");
        lines.push(
          `Invoke the recommended tool with the args above. The arguments are already validated against the target tool's input schema. If the routing looks wrong, fall back to \`gt_search({ query: "${query.replace(/"/g, '\\"')}" })\` — it never fails to return *something* useful.`,
        );
        lines.push("");
        lines.push("---");
        lines.push("");
        lines.push(renderRoutingTable());

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
