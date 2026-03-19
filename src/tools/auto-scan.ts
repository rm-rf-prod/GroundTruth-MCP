import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupByAlias, lookupById, fuzzySearch } from "../sources/registry.js";
import { fetchDocs } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL, safeguardPath } from "../utils/guard.js";
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

export interface DependencySource {
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

export async function detectDependencies(projectPath: string): Promise<DependencySource[]> {
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

  // pyproject.toml (Python) — supports both Poetry and PEP 517 (uv, hatch, rye, pdm)
  const pyproject = await readFileIfExists(join(projectPath, "pyproject.toml"));
  if (pyproject) {
    const deps: string[] = [];

    // [tool.poetry.dependencies] — Poetry format
    const poetryBlock = pyproject.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/);
    if (poetryBlock?.[1]) {
      const lines = poetryBlock[1].split("\n");
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
        if (match?.[1] && match[1] !== "python") {
          deps.push(match[1]);
        }
      }
    }

    // [project.dependencies] — PEP 517 format (uv, hatch, rye, pdm)
    const pep517Block = pyproject.match(/\[project\]([\s\S]*?)(?:\n\[(?!project\.)|$)/);
    if (pep517Block?.[1]) {
      const depsArrayMatch = pep517Block[1].match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsArrayMatch?.[1]) {
        const lines = depsArrayMatch[1].split("\n");
        for (const line of lines) {
          const trimmed = line.trim().replace(/^["']|["'],?$/g, "");
          const pkgName = trimmed.split(/[>=<!~\[\s]/)[0]?.trim();
          if (pkgName && pkgName.length > 0 && !pkgName.startsWith("#")) {
            deps.push(pkgName);
          }
        }
      }
    }

    // [project.optional-dependencies.*] — extras/optional deps
    const optionalBlocks = pyproject.matchAll(/\[project\.optional-dependencies\.[^\]]+\]([\s\S]*?)(?:\[|$)/g);
    for (const block of optionalBlocks) {
      if (block[1]) {
        const lines = block[1].split("\n");
        for (const line of lines) {
          const trimmed = line.trim().replace(/^["']|["'],?$/g, "");
          const pkgName = trimmed.split(/[>=<!~\[\s]/)[0]?.trim();
          if (pkgName && pkgName.length > 0 && !pkgName.startsWith("#")) {
            deps.push(pkgName);
          }
        }
      }
    }

    const uniqueDeps = [...new Set(deps)];
    if (uniqueDeps.length > 0) {
      sources.push({ file: "pyproject.toml", dependencies: uniqueDeps });
    }
  }

  // Cargo.toml (Rust)
  const cargoToml = await readFileIfExists(join(projectPath, "Cargo.toml"));
  if (cargoToml) {
    const deps: string[] = [];
    const depsSection = cargoToml.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/);
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

  // pom.xml (Maven / Java)
  const pomXml = await readFileIfExists(join(projectPath, "pom.xml"));
  if (pomXml) {
    const deps: string[] = [];
    // Match <artifactId> inside <dependency> blocks
    const depBlocks = pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g);
    for (const block of depBlocks) {
      if (block[1]) {
        const artifactMatch = block[1].match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/);
        if (artifactMatch?.[1]) {
          deps.push(artifactMatch[1]);
        }
      }
    }
    if (deps.length > 0) {
      sources.push({ file: "pom.xml", dependencies: deps });
    }
  }

  // composer.json (PHP)
  const composerJson = await readFileIfExists(join(projectPath, "composer.json"));
  if (composerJson) {
    try {
      const composer = JSON.parse(composerJson) as {
        require?: Record<string, unknown>;
        "require-dev"?: Record<string, unknown>;
      };
      const deps = [
        ...Object.keys(composer.require ?? {}),
        ...Object.keys(composer["require-dev"] ?? {}),
      ]
        .filter((p) => p !== "php" && !p.startsWith("php-") && !p.startsWith("ext-"))
        .map((p) => {
          // Strip vendor prefix: vendor/package -> package
          const parts = p.split("/");
          return parts[parts.length - 1] ?? p;
        });
      if (deps.length > 0) {
        sources.push({ file: "composer.json", dependencies: deps });
      }
    } catch {
      // malformed composer.json
    }
  }

  // build.gradle / build.gradle.kts (Gradle / Android)
  for (const gradleFile of ["build.gradle", "build.gradle.kts"]) {
    const gradleContent = await readFileIfExists(join(projectPath, gradleFile));
    if (gradleContent) {
      const deps: string[] = [];
      // Match: implementation("group:artifact:version") and similar
      const depMatches = gradleContent.matchAll(
        /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*[\("']+([^:'"]+):([^:'"]+):/g,
      );
      for (const m of depMatches) {
        if (m[2]) deps.push(m[2]);
      }
      if (deps.length > 0) {
        sources.push({ file: gradleFile, dependencies: deps });
        break; // only process one gradle file
      }
    }
  }

  // Gemfile (Ruby / Rails)
  const gemfile = await readFileIfExists(join(projectPath, "Gemfile"));
  if (gemfile) {
    const deps: string[] = [];
    for (const line of gemfile.split("\n")) {
      const match = line.trim().match(/^gem\s+['"]([^'"]+)['"]/);
      if (match?.[1]) deps.push(match[1]);
    }
    if (deps.length > 0) sources.push({ file: "Gemfile", dependencies: deps });
  }

  // deno.json / deno.jsonc (Deno)
  for (const denoFile of ["deno.json", "deno.jsonc"]) {
    const denoJson = await readFileIfExists(join(projectPath, denoFile));
    if (denoJson) {
      try {
        const parsed = JSON.parse(denoJson.replace(/\/\/[^\n]*/g, "")) as {
          imports?: Record<string, string>;
        };
        const deps = Object.keys(parsed.imports ?? {})
          .map((k) => k.replace(/^npm:/, "").split("@")[0] ?? k)
          .filter((k) => k.length > 0);
        if (deps.length > 0) sources.push({ file: denoFile, dependencies: deps });
      } catch {
        // malformed
      }
      break;
    }
  }

  // pubspec.yaml (Flutter / Dart)
  const pubspec = await readFileIfExists(join(projectPath, "pubspec.yaml"));
  if (pubspec) {
    const deps: string[] = [];
    const depsSection = pubspec.match(/^dependencies:\s*\n((?:[ \t]+.+\n)*)/m);
    if (depsSection?.[1]) {
      for (const line of depsSection[1].split("\n")) {
        const match = line.trim().match(/^([a-zA-Z0-9_]+):/);
        if (match?.[1] && match[1] !== "flutter" && match[1] !== "sdk") deps.push(match[1]);
      }
    }
    if (deps.length > 0) sources.push({ file: "pubspec.yaml", dependencies: deps });
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
  // Bun / Deno type stubs
  "@types/bun", "bun-types",
  // CLI color utilities
  "chalk", "kleur", "picocolors", "ansi-colors",
  // CLI argument parsers
  "commander", "yargs", "meow", "minimist",
  // Glob utilities
  "glob", "fast-glob", "globby",
  // Build tools
  "microbundle", "tsup", "unbuild", "ncc",
  // Path/OS utilities
  "path", "os", "fs", "stream", "buffer",
]);

export function registerAutoScanTool(server: McpServer): void {
  server.registerTool(
    "gt_auto_scan",
    {
      title: "Auto-Scan Project Dependencies",
      description: `Automatically detect all dependencies in a project and fetch latest best practices for each. Say "use gt" to invoke.

Reads: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, composer.json, build.gradle — whichever exist.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      outputSchema: z.object({
        projectPath: z.string(),
        topic: z.string(),
        filesScanned: z.array(z.string()),
        totalDependencies: z.number(),
        matched: z.array(z.string()),
        unmatched: z.array(z.string()),
        results: z.array(z.object({ name: z.string(), url: z.string(), content: z.string() })),
      }),
    },
    async ({ projectPath, topic = "latest best practices", tokensPerLib }) => {
      let resolvedPath: string;
      try {
        resolvedPath = safeguardPath(projectPath ?? process.cwd());
      } catch {
        return { content: [{ type: "text", text: `Invalid project path.` }] };
      }

      if (isExtractionAttempt(topic)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const sources = await detectDependencies(resolvedPath);

      if (sources.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No dependency files found in: ${resolvedPath}\n\nLooked for: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod\n\nTry providing the correct projectPath or use gt_get_docs / gt_best_practices directly.`,
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
          ? `> Note: Showing top ${topMatched.length} of ${matched.length} matched libraries (capped at 20). Use gt_best_practices for individual deep-dives.`
          : "",
        unmatched.length > 0
          ? `> Unresolved: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? ` +${unmatched.length - 10} more` : ""} — use gt_resolve_library for these.`
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
