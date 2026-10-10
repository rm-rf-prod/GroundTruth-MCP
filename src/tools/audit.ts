import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { safeguardPath, withToolTimeout } from "../utils/guard.js";
import { withTelemetry } from "../services/telemetry.js";
import { readProjectFiles, runPatterns, groupIssues, type SourceFile } from "./audit-scan.js";
import { fetchBestPractice } from "./audit-fixes.js";
import { renderAuditReport } from "./audit-report.js";

// Re-exported so existing callers and tests keep one stable import path.
export { AUDIT_PATTERNS } from "../sources/audit-patterns.js";
export { buildCommentMap } from "../utils/comment-map.js";

const InputSchema = z.object({
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Project root (default: cwd)"),
  categories: z
    .array(
      z.enum([
        "layout",
        "performance",
        "accessibility",
        "security",
        "react",
        "nextjs",
        "typescript",
        "node",
        "python",
        "vue",
        "svelte",
        "angular",
        "testing",
        "mobile",
        "api",
        "css",
        "seo",
        "i18n",
        "all",
      ]),
    )
    .default(["all"]),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(8000)
    .default(4000),
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50),
});

export function registerAuditTool(server: McpServer): void {
  server.registerTool(
    "gt_audit",
    {
      // Claude Code swaps oversized tool results for a file reference; these two
      // tools legitimately return long reports, so raise their inline ceiling.
      _meta: { "anthropic/maxResultSizeChars": 200_000 },
      title: "Audit Project Code",
      description: "Scan the project's own source files for issues (file:line) and attach fixes from official docs. Use categories [\"all\"] for broad requests. Best practices for its dependencies: gt_auto_scan.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ projectPath, categories, tokens, maxFiles }) => {
      return withTelemetry("gt_audit", async (ctx) => {
        let resolvedPath: string;
        try {
          resolvedPath = safeguardPath(projectPath ?? process.cwd());
        } catch {
          return { content: [{ type: "text", text: `Invalid project path.` }] };
        }

        let files: SourceFile[];
        try {
          files = await readProjectFiles(resolvedPath, maxFiles);
        } catch {
          return { content: [{ type: "text", text: `Could not read project at: ${resolvedPath}` }] };
        }

        if (files.length === 0) {
          return { content: [{ type: "text", text: `No source files found in: ${resolvedPath}` }] };
        }

        const allIssues = runPatterns(files, categories);
        const SRANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        allIssues.sort((a, b) => (SRANK[a.severity] ?? 4) - (SRANK[b.severity] ?? 4));

        const grouped = groupIssues(allIssues);
        const topIssues = Array.from(grouped.entries()).slice(0, 6);
        const bpMap = new Map<string, string>();

        await withToolTimeout(
          () => Promise.allSettled(
            topIssues.map(async ([title, issues]) => {
              const query = issues[0]?.docsQuery ?? title;
              const bp = await fetchBestPractice(query, Math.floor(tokens / topIssues.length));
              bpMap.set(title, bp);
            }),
          ),
          [],
        );

        const report = renderAuditReport({
          projectPath: resolvedPath,
          filesScanned: files.length,
          issues: allIssues,
          grouped,
          bpMap,
          categories,
        });

        ctx.resolved = allIssues.length > 0 || files.length > 0;
        return {
          content: [{ type: "text", text: report.text }],
          structuredContent: report.structuredContent,
        };
      });
    },
  );
}
