import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fuzzySearch, lookupByAlias } from "../sources/registry.js";
import type { LibraryMatch } from "../types.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import {
  resolveFromNpm,
  resolveFromPypi,
  resolveFromCrates,
  resolveFromGo,
  searchNpm,
  searchGitHub,
} from "../services/resolve.js";
import { withTelemetry } from "../services/telemetry.js";

const InputSchema = z.object({
  libraryName: z
    .string()
    .min(1)
    .max(200)
    .describe("e.g. 'nextjs'"),
  query: z
    .string()
    .max(500)
    .optional()
    .describe("Intended use; ranks results"),
});

import { formatResults, safeMatch } from "./resolve-format.js";

export function registerResolveTool(server: McpServer): void {
  server.registerTool(
    "gt_resolve_library",
    {
      title: "Resolve Library",
      description: "Find a library's GroundTruth ID ('vercel/next.js', 'npm:express') and its docs, llms.txt and GitHub URLs, from the registry, npm, PyPI, crates.io, Go and GitHub. Only for ambiguous or unknown names: other tools take plain names. 2-20 names: gt_batch_resolve. Registry is Elastic-2.0: look up named libraries only, never enumerate.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ libraryName, query }) => {
     return withTelemetry("gt_resolve_library", async (ctx) => {
      const name = libraryName.trim();

      if (isExtractionAttempt(name) || (query !== undefined && isExtractionAttempt(query))) {
        ctx.resolved = true;
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const matches: LibraryMatch[] = [];

      // 1. Exact alias lookup in registry
      const exact = lookupByAlias(name);
      if (exact) {
        matches.push({
          id: exact.id,
          name: exact.name,
          description: exact.description,
          docsUrl: exact.docsUrl,
          llmsTxtUrl: exact.llmsTxtUrl,
          ...(exact.llmsFullTxtUrl !== undefined && { llmsFullTxtUrl: exact.llmsFullTxtUrl }),
          githubUrl: exact.githubUrl,
          score: 100,
          source: "registry",
        });
      }

      // 2. Fuzzy search registry
      if (matches.length === 0) {
        const fuzzy = fuzzySearch(name, 5);
        for (const entry of fuzzy) {
          if (!matches.some((m) => m.id === entry.id)) {
            matches.push({
              id: entry.id,
              name: entry.name,
              description: entry.description,
              docsUrl: entry.docsUrl,
              llmsTxtUrl: entry.llmsTxtUrl,
              ...(entry.llmsFullTxtUrl !== undefined && { llmsFullTxtUrl: entry.llmsFullTxtUrl }),
              githubUrl: entry.githubUrl,
              score: 80,
              source: "registry",
            });
          }
        }
      }

      // 3. Fallback to package registries (npm, PyPI, crates.io, Go) — only when
      // the registry gave nothing, or very few low-quality fuzzy hits. Multiple
      // decent fuzzy results suppress the external round-trips (a well-aliased
      // entry should not trigger npm/pypi lookups just for scoring < 90).
      if (matches.length === 0 || (matches.length < 3 && matches.every((m) => m.source === "registry" && m.score < 85))) {
        const [npmResult, pypiResult] = await Promise.all([
          resolveFromNpm(name),
          resolveFromPypi(name),
        ]);
        if (npmResult && !matches.some((m) => m.id === npmResult.id)) matches.push(npmResult);
        if (pypiResult && !matches.some((m) => m.id === pypiResult.id)) matches.push(pypiResult);

        if (matches.length === 0) {
          const [cratesResult, goResult] = await Promise.all([
            resolveFromCrates(name),
            resolveFromGo(name),
          ]);
          if (cratesResult && !matches.some((m) => m.id === cratesResult.id)) matches.push(cratesResult);
          if (goResult && !matches.some((m) => m.id === goResult.id)) matches.push(goResult);
        }

        if (matches.length === 0) {
          const [npmSearchResult, githubResult] = await Promise.all([
            searchNpm(name),
            searchGitHub(name),
          ]);
          if (npmSearchResult) matches.push(npmSearchResult);
          if (githubResult && !matches.some((m) => m.id === githubResult.id)) matches.push(githubResult);
        }
      }

      // Boost score if query tokens match description/tags
      if (query && query.trim()) {
        // Token-level match: a multi-word query ("async runtime") should boost a
        // description that contains the words separately, not only as an exact
        // substring. .some() avoids under-boosting when the query has stop words.
        const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        for (const m of matches) {
          const desc = m.description.toLowerCase();
          if (tokens.some((t) => desc.includes(t))) m.score += 5;
        }
        matches.sort((a, b) => b.score - a.score);
      }

      const top = matches.slice(0, 5).map(safeMatch);
      const text = withNotice(formatResults(top));
      ctx.resolved = matches.length > 0;

      return {
        content: [{ type: "text", text }],
        structuredContent: { matches: top },
      };
     });
    },
  );
}
