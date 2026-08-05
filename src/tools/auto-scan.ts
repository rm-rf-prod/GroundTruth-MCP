import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withNotice, withToolTimeout, safeguardPath } from "../utils/guard.js";
import type { LibraryEntry } from "../types.js";
import { detectAllVersions } from "../utils/lockfile.js";
import { withTelemetry } from "../services/telemetry.js";
import { detectDependencies } from "../utils/deps/manifest.js";
import { SKIP_DEPS } from "../sources/skip-deps.js";
import { matchDepToRegistry, fetchLibraryBatches, type LibraryResult } from "./auto-scan-fetch.js";
import { renderScanReport } from "./auto-scan-report.js";

// Re-exported so the existing test import path stays valid.
export { detectDependencies, type DependencySource } from "../utils/deps/manifest.js";


const InputSchema = z.object({
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe(
      "Absolute path to the project directory. Defaults to current working directory. The tool will read package.json, requirements.txt, Cargo.toml, go.mod, etc.",
    ),
  topic: z
    .string()
    .max(300)
    .optional()
    .describe(
      "What to look up for each detected dependency. Examples: 'latest best practices', 'security', 'performance', 'migration'. Leave empty for general best practices.",
    ),
  tokensPerLib: z
    .number()
    .int()
    .min(500)
    .max(4000)
    .default(1500)
    .describe("Max tokens per library (default: 1500). Lower = more libraries covered."),
});

export function registerAutoScanTool(server: McpServer): void {
  server.registerTool(
    "gt_auto_scan",
    {
      // Claude Code swaps oversized tool results for a file reference; these two
      // tools legitimately return long reports, so raise their inline ceiling.
      _meta: { "anthropic/maxResultSizeChars": 200_000 },
      title: "Auto-Scan Project Dependencies",
      description: `Automatically detect all dependencies in a project and fetch latest best practices for each. Say "use gt" to invoke.

Reads: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, composer.json, build.gradle — whichever exist.

Fetches best practices for your installed DEPENDENCIES — to scan your own source code for issues, use gt_audit instead. Unrecognized dependencies are listed separately, never fail the call.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ projectPath, topic = "latest best practices", tokensPerLib }) => {
      return withTelemetry("gt_auto_scan", async (ctx) => {
        let resolvedPath: string;
        try {
          resolvedPath = safeguardPath(projectPath ?? process.cwd());
        } catch {
          return { content: [{ type: "text", text: `Invalid project path.` }] };
        }

        // No extraction guard on `topic` — it only scopes what to look up per
        // already-detected dependency and cannot enumerate the registry.
        const sources = await detectDependencies(resolvedPath);

        if (sources.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No dependency files found in: ${resolvedPath}\n\nLooked for: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod\n\nTry providing the correct projectPath or use gt_get_docs / gt_best_practices directly.`,
            }],
          };
        }

        // Deduplicate and filter
        const allDeps = new Set<string>();
        for (const src of sources) {
          for (const dep of src.dependencies) {
            if (!SKIP_DEPS.has(dep.toLowerCase())) allDeps.add(dep);
          }
        }

        // Match to registry, deduplicating entries reached via different package names
        const matched: Array<{ dep: string; entry: LibraryEntry }> = [];
        const unmatched: string[] = [];
        for (const dep of allDeps) {
          const entry = matchDepToRegistry(dep);
          if (!entry) {
            unmatched.push(dep);
          } else if (!matched.some((m) => m.entry.id === entry.id)) {
            matched.push({ dep, entry });
          }
        }

        // Cap at 20 libraries to avoid overwhelming responses
        const topMatched = matched.slice(0, 20);
        const versions = await detectAllVersions(resolvedPath, [...allDeps]);
        const results: LibraryResult[] = [];
        await withToolTimeout(
          () => fetchLibraryBatches(topMatched, versions, topic, tokensPerLib, results),
          undefined,
        );

        const report = renderScanReport({
          projectPath: resolvedPath,
          topic,
          sources,
          totalDeps: allDeps.size,
          matchedCount: matched.length,
          topMatched,
          unmatched,
          versions,
          results,
        });

        ctx.resolved = results.some((r) => !r.failed);
        return {
          content: [{ type: "text", text: withNotice(report.text) }],
          structuredContent: report.structuredContent,
        };
      });
    },
  );
}
