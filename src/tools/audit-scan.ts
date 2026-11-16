import { readdir, readFile, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { AUDIT_PATTERNS, type Issue } from "../sources/audit-patterns.js";
import { buildCommentMap, SKIP_FILE_RE } from "../utils/comment-map.js";
import { NOTEBOOK_MAX_BYTES, flattenNotebook, parseNotebook, type NotebookSource } from "../utils/notebook.js";

export interface SourceFile {
  path: string;
  content: string;
  /** Notebooks only: per content line, the code cell and the line within it. */
  lineMap?: NotebookSource["lineMap"];
}

export async function readProjectFiles(
  projectPath: string,
  maxFiles: number,
): Promise<SourceFile[]> {
  const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".mjs", ".py", ".vue", ".svelte", ".ipynb"]);
  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", "dist", "build", ".turbo",
    "coverage", ".cache", "out", ".vercel", "storybook-static",
    "__pycache__", ".venv", "venv", "env", ".ipynb_checkpoints",
  ]);

  const files: SourceFile[] = [];

  // At most 4 notebooks parsed at once (each can be 5 MB).
  let activeNotebooks = 0;
  const slotWaiters: Array<() => void> = [];
  async function withNotebookSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (activeNotebooks >= 4) await new Promise<void>((r) => slotWaiters.push(r));
    activeNotebooks++;
    try {
      return await fn();
    } finally {
      activeNotebooks--;
      slotWaiters.shift()?.();
    }
  }

  async function readSource(fullPath: string): Promise<Omit<SourceFile, "path"> | null> {
    try {
      const isNotebook = extname(fullPath) === ".ipynb";
      if (isNotebook) return await withNotebookSlot(() => readSourceUnlimited(fullPath, true));
      return await readSourceUnlimited(fullPath, false);
    } catch {
      return null;
    }
  }

  async function readSourceUnlimited(fullPath: string, isNotebook: boolean): Promise<Omit<SourceFile, "path"> | null> {
    try {
      const s = await stat(fullPath);
      if (s.size > (isNotebook ? NOTEBOOK_MAX_BYTES : 200_000)) return null;
      const raw = await readFile(fullPath, "utf-8");
      if (!isNotebook) return { content: raw };
      const cells = parseNotebook(raw);
      return cells === null ? null : flattenNotebook(cells);
    } catch {
      return null; // unreadable — skip
    }
  }

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 6 || files.length >= maxFiles) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const isSource = (e: (typeof entries)[number]): boolean => e.isFile() && SOURCE_EXT.has(extname(e.name));
      // Start this directory's reads together, capped at the remaining budget;
      // consume them in listing order so results match a sequential walk.
      const pending = new Map<string, ReturnType<typeof readSource>>();
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
          const source = await (pending.get(entry.name) ?? readSource(fullPath));
          if (source !== null) files.push({ path: relative(projectPath, fullPath), ...source });
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
      const cellLine = file.lineMap?.[i];

      // Skip lines that are entirely inside a block comment
      const lineIsInBlockComment = commentMap.has(charOffset);
      // Skip single-line comments (JS/TS // and Python #)
      const trimmed = line.trimStart();
      const lineIsLineComment = trimmed.startsWith("//") || trimmed.startsWith("#");

      if (lineIsInBlockComment || lineIsLineComment) {
        charOffset += line.length + 1;
        continue;
      }

      for (const pattern of AUDIT_PATTERNS) {
        if (!checkAll && !categories.includes(pattern.category)) continue;
        if (pattern.test(line, file.content, charOffset, lines, i, file.path)) {
          const issue: Issue = {
            file: file.path,
            line: cellLine?.[1] ?? i + 1,
            category: pattern.category,
            severity: pattern.severity,
            title: pattern.title,
            detail: pattern.detail,
            fix: pattern.fix,
          };
          if (pattern.docsQuery !== undefined) issue.docsQuery = pattern.docsQuery;
          if (cellLine) issue.cell = cellLine[0];
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
