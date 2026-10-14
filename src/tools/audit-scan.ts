import { readdir, readFile, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { AUDIT_PATTERNS, type Issue } from "../sources/audit-patterns.js";
import { buildCommentMap, SKIP_FILE_RE } from "../utils/comment-map.js";

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Extract executable Python code from a Jupyter Notebook (.ipynb) JSON string.
 * Extracts all code cells into Python code with cell markers.
 * Comments out IPython magics (%...) and shell escapes (!...) to prevent false positives.
 * Returns null if the JSON is malformed or has no cells array.
 */
export function extractNotebookCode(raw: string): string | null {
  try {
    const nb = JSON.parse(raw) as { cells?: unknown };
    if (!nb || typeof nb !== "object" || !Array.isArray(nb.cells)) return null;

    const lines: string[] = [];
    let cellNum = 0;

    for (const cell of nb.cells) {
      if (!cell || typeof cell !== "object") continue;
      cellNum++;

      const c = cell as { cell_type?: unknown; source?: unknown };
      if (c.cell_type === "code" && c.source !== undefined) {
        lines.push(`# %% [code cell ${cellNum}]`);
        const source = c.source;
        const joined = Array.isArray(source)
          ? source.map(String).join("")
          : typeof source === "string"
            ? source
            : "";
        const cellLines = joined.split(/\r?\n/);
        if (cellLines.length > 0 && cellLines[cellLines.length - 1] === "") {
          cellLines.pop();
        }

        for (const line of cellLines) {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("%") || trimmed.startsWith("!")) {
            lines.push(`# ${line}`);
          } else {
            lines.push(line);
          }
        }
      }
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

export async function readProjectFiles(
  projectPath: string,
  maxFiles: number,
): Promise<SourceFile[]> {
  const SOURCE_EXT = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".mjs", ".py", ".vue", ".svelte", ".ipynb",
    ".sql", ".r", ".R", ".jl",
  ]);
  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", "dist", "build", ".turbo",
    "coverage", ".cache", "out", ".vercel", "storybook-static",
    "__pycache__", ".venv", "venv", "env", ".ipynb_checkpoints",
  ]);

  const files: SourceFile[] = [];

  async function readSource(fullPath: string): Promise<string | null> {
    try {
      const s = await stat(fullPath);
      const isNotebook = extname(fullPath) === ".ipynb";
      // Notebooks can embed base64 image plots/outputs; allow a higher size budget
      const maxBytes = isNotebook ? 2_000_000 : 200_000;
      if (s.size > maxBytes) return null;
      const raw = await readFile(fullPath, "utf-8");
      if (isNotebook) return extractNotebookCode(raw);
      return raw;
    } catch {
      return null; // unreadable — skip
    }
  }

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 6 || files.length >= maxFiles) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const isSource = (e: (typeof entries)[number]): boolean =>
        e.isFile() && SOURCE_EXT.has(extname(e.name)) && !e.name.endsWith("-checkpoint.ipynb");
      // Start this directory's reads together, capped at the remaining budget;
      // consume them in listing order so results match a sequential walk.
      const pending = new Map<string, Promise<string | null>>();
      for (const entry of entries) {
        if (pending.size >= maxFiles - files.length) break;
        if (isSource(entry)) pending.set(entry.name, readSource(join(dir, entry.name)));
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), depth + 1);
        } else if (isSource(entry)) {
          const fullPath = join(dir, entry.name);
          const content = await (pending.get(entry.name) ?? readSource(fullPath));
          if (content !== null) files.push({ path: relative(projectPath, fullPath), content });
        }
      }
    } catch {
      // unreadable dir — skip
    }
  }

  await walk(projectPath);
  return files;
}
export function runPatterns(
  files: SourceFile[],
  categories: string[],
): Issue[] {
  const issues: Issue[] = [];
  const checkAll = categories.includes("all");

  for (const file of files) {
    if (SKIP_FILE_RE.test(file.path)) continue;

    const commentMap = buildCommentMap(file.content);
    const lines = file.content.split("\n");
    let charOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      // Skip lines that are entirely inside a block comment
      const lineIsInBlockComment = commentMap.has(charOffset);
      // Skip single-line comments (JS/TS //, Python/R/Julia #, and SQL --)
      const trimmed = line.trimStart();
      const lineIsLineComment = trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--");

      if (lineIsInBlockComment || lineIsLineComment) {
        charOffset += line.length + 1;
        continue;
      }

      for (const pattern of AUDIT_PATTERNS) {
        if (!checkAll && !categories.includes(pattern.category)) continue;
        if (pattern.test(line, file.content, charOffset, lines, i, file.path)) {
          const issue: Issue = {
            file: file.path,
            line: i + 1,
            category: pattern.category,
            severity: pattern.severity,
            title: pattern.title,
            detail: pattern.detail,
            fix: pattern.fix,
          };
          if (pattern.docsQuery !== undefined) issue.docsQuery = pattern.docsQuery;
          issues.push(issue);
          break; // one issue per pattern per line
        }
      }
      charOffset += line.length + 1;
    }
  }

  return issues;
}
export function groupIssues(issues: Issue[]): Map<string, Issue[]> {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.title);
    if (list) list.push(issue);
    else groups.set(issue.title, [issue]);
  }
  return groups;
}
