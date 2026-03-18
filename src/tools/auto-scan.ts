import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupByAlias, lookupById, fuzzySearch } from "../sources/registry.js";
import { fetchDocs } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { DEFAULT_TOKEN_LIMIT } from "../constants.js";
import type { LibraryEntry } from "../types.js";

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

interface DependencySource {
  file: string;
  dependencies: string[];
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    const { readFile } = await import("fs/promises");
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function detectDependencies(projectPath: string): Promise<DependencySource[]> {
  const { join } = await import("path");
  const sources: DependencySource[] = [];

  // package.json (Node.js)
  const pkgJson = await readFileIfExists(join(projectPath, "package.json"));
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ];
      if (deps.length > 0) {
        sources.push({ file: "package.json", dependencies: deps });
      }
    } catch {
      // malformed package.json
    }
  }

  // requirements.txt (Python)
  const requirementsTxt = await readFileIfExists(join(projectPath, "requirements.txt"));
  if (requirementsTxt) {
    const deps = requirementsTxt
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-"))
      .map((line) => line.split(/[=><!~\[]/)[0]?.trim() ?? "")
      .filter(Boolean);
    if (deps.length > 0) {
      sources.push({ file: "requirements.txt", dependencies: deps });
    }
  }

  // pyproject.toml (Python)
  const pyproject = await readFileIfExists(join(projectPath, "pyproject.toml"));
  if (pyproject) {
    const deps: string[] = [];
    const dependenciesBlock = pyproject.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/);
    if (dependenciesBlock?.[1]) {
      const lines = dependenciesBlock[1].split("\n");
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
        if (match?.[1] && match[1] !== "python") {
          deps.push(match[1]);
        }
      }
    }
    if (deps.length > 0) {
      sources.push({ file: "pyproject.toml", dependencies: deps });
    }
  }

  // Cargo.toml (Rust)
  const cargoToml = await readFileIfExists(join(projectPath, "Cargo.toml"));
  if (cargoToml) {
    const deps: string[] = [];
    const depsSection = cargoToml.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depsSection?.[1]) {
      const lines = depsSection[1].split("\n");
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
        if (match?.[1]) {
          deps.push(match[1]);
        }
      }
    }
    if (deps.length > 0) {
      sources.push({ file: "Cargo.toml", dependencies: deps });
    }
  }

  // go.mod (Go)
  const goMod = await readFileIfExists(join(projectPath, "go.mod"));
  if (goMod) {
    const deps: string[] = [];
    const requireBlock = goMod.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock?.[1]) {
      const lines = requireBlock[1].split("\n");
      for (const line of lines) {
        const match = line.trim().match(/^([^\s]+)/);
        if (match?.[1] && match[1] !== "//") {
          // extract last path segment as identifier
          const segments = match[1].split("/");
          const name = segments[segments.length - 1] ?? match[1];
          deps.push(name);
        }
      }
    }
    if (deps.length > 0) {
      sources.push({ file: "go.mod", dependencies: deps });
    }
  }

  return sources;
}

function matchDepToRegistry(depName: string): LibraryEntry | null {
  // exact alias first
  const byAlias = lookupByAlias(depName);
  if (byAlias) return byAlias;

  // strip scope from scoped packages (@scope/name -> name)
  if (depName.startsWith("@")) {
    const unscoped = depName.split("/")[1];
    if (unscoped) {
      const byScopedAlias = lookupByAlias(unscoped);
      if (byScopedAlias) return byScopedAlias;
    }
  }

  // fuzzy — only use if score is high enough (first result, short names only)
  const fuzzy = fuzzySearch(depName, 1);
  if (fuzzy.length > 0 && fuzzy[0]) {
    const entry = lookupById(fuzzy[0].id);
    if (entry) return entry;
  }

  return null;
}

// Known skip list — dev tooling and utility packages with no useful best-practices docs
const SKIP_DEPS = new Set([
  // TypeScript
  "typescript", "ts-node", "tsx", "tsc-alias",
  // Type definitions
  "@types/node", "@types/react", "@types/react-dom", "@types/jest", "@types/lodash",
  "@types/express", "@types/cors", "@types/body-parser", "@types/uuid",
  // Linting / formatting
  "eslint", "prettier", "eslint-config-next", "eslint-config-prettier",
  "eslint-plugin-react", "eslint-plugin-react-hooks", "eslint-plugin-jsx-a11y",
  "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin",
  // Testing runners
  "jest", "vitest", "@vitest/coverage-v8", "@vitest/ui",
  // Bundlers / build tools
  "webpack", "webpack-cli", "vite", "rollup", "esbuild", "parcel", "turbopack",
  "terser", "swc", "@swc/core", "@swc/cli",
  // Node utilities
  "cross-env", "dotenv", "nodemon", "concurrently", "rimraf", "copyfiles",
  "source-map-support", "tslib", "module-alias",
  // PostCSS / autoprefixer (config-only, no best-practices needed)
  "postcss", "autoprefixer", "cssnano",
  // Babel
  "babel-jest", "@babel/core", "@babel/preset-env", "@babel/preset-typescript",
  // Husky / lint-staged
  "husky", "lint-staged", "commitlint",
  // Misc utility
  "lodash", "lodash-es", "underscore",
]);

export function registerAutoScanTool(server: McpServer): void {
  server.registerTool(
    "ws_auto_scan",
    {
      title: "Auto-Scan Project Dependencies",
      description: `Automatically detect all dependencies in a project and fetch latest best practices for each.

Reads: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod — whichever exist.

Use this when you want to:
- Get current best practices for everything in a project at once
- Check if you're using the recommended patterns for your entire stack
- Audit a project for outdated patterns across all dependencies
- Start a refactor and need context on every library in use

Say "use ws" or "ws scan" to invoke this automatically.

Examples:
- ws_auto_scan({}) — scan current directory, fetch general best practices
- ws_auto_scan({ topic: "latest best practices" })
- ws_auto_scan({ topic: "security vulnerabilities" })
- ws_auto_scan({ topic: "migration to latest version" })
- ws_auto_scan({ projectPath: "/path/to/project", topic: "performance" })`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ projectPath, topic = "latest best practices", tokensPerLib }) => {
      const resolvedPath = projectPath ?? process.cwd();

      if (isExtractionAttempt(topic)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const sources = await detectDependencies(resolvedPath);

      if (sources.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No dependency files found in: ${resolvedPath}\n\nLooked for: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod\n\nTry providing the correct projectPath or use ws_get_docs / ws_best_practices directly.`,
            },
          ],
        };
      }

      // Deduplicate and filter
      const allDeps = new Set<string>();
      for (const src of sources) {
        for (const dep of src.dependencies) {
          if (!SKIP_DEPS.has(dep.toLowerCase())) {
            allDeps.add(dep);
          }
        }
      }

      // Match to registry
      const matched: Array<{ dep: string; entry: LibraryEntry }> = [];
      const unmatched: string[] = [];

      for (const dep of allDeps) {
        const entry = matchDepToRegistry(dep);
        if (entry) {
          // deduplicate registry entries (same lib, different package names)
          if (!matched.some((m) => m.entry.id === entry.id)) {
            matched.push({ dep, entry });
          }
        } else {
          unmatched.push(dep);
        }
      }

      // Cap at 20 libraries to avoid overwhelming responses
      const topMatched = matched.slice(0, 20);

      // Fetch best practices in parallel (with concurrency limit)
      const CONCURRENCY = 4;
      const results: Array<{ name: string; content: string; url: string }> = [];

      for (let i = 0; i < topMatched.length; i += CONCURRENCY) {
        const batch = topMatched.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(async ({ entry }) => {
            try {
              const fetchResult = await fetchDocs(
                entry.docsUrl,
                entry.llmsTxtUrl,
                entry.llmsFullTxtUrl,
              );
              const safe = sanitizeContent(fetchResult.content);
              const enrichedTopic = `${topic} best practices patterns guide`;
              const { text } = extractRelevantContent(safe, enrichedTopic, tokensPerLib);
              return { name: entry.name, content: text, url: fetchResult.url };
            } catch {
              return { name: entry.name, content: `Could not fetch docs for ${entry.name}.`, url: entry.docsUrl };
            }
          }),
        );
        for (const r of batchResults) {
          if (r.status === "fulfilled") {
            results.push(r.value);
          }
        }
      }

      // Build output
      const filesList = sources.map((s) => `- ${s.file} (${s.dependencies.length} deps)`).join("\n");
      const header = [
        `# Project Dependency Scan`,
        `> Path: ${resolvedPath}`,
        `> Topic: ${topic}`,
        `> Found ${allDeps.size} dependencies across ${sources.length} file(s)`,
        `> Matched ${topMatched.length} to registry, fetched best practices for each`,
        "",
        `**Files scanned:**`,
        filesList,
        "",
        topMatched.length < matched.length
          ? `> Note: Showing top ${topMatched.length} of ${matched.length} matched libraries (capped at 20). Use ws_best_practices for individual deep-dives.`
          : "",
        unmatched.length > 0
          ? `> Unresolved: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? ` +${unmatched.length - 10} more` : ""} — use ws_resolve_library for these.`
          : "",
        "",
        "---",
        "",
      ]
        .filter((l) => l !== undefined)
        .join("\n");

      const sections = results
        .map(
          (r) =>
            `## ${r.name}\n> Source: ${r.url}\n\n${r.content}\n\n---\n`,
        )
        .join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + sections) }],
        structuredContent: {
          projectPath: resolvedPath,
          topic,
          filesScanned: sources.map((s) => s.file),
          totalDependencies: allDeps.size,
          matched: topMatched.map((m) => m.entry.id),
          unmatched: unmatched.slice(0, 20),
          results: results.map((r) => ({ name: r.name, url: r.url, content: r.content })),
        },
      };
    },
  );
}
