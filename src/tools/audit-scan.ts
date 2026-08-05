import { readdir, readFile, stat } from "fs/promises";
import { join, extname, relative } from "path";
import { AUDIT_PATTERNS, type Issue } from "../sources/audit-patterns.js";
import { buildCommentMap, SKIP_FILE_RE } from "../utils/comment-map.js";

export interface SourceFile {
  path: string;
  content: string;
}

export async function readProjectFiles(
  projectPath: string,
  maxFiles: number,
): Promise<SourceFile[]> {
  const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".mjs", ".py", ".vue", ".svelte"]);
  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", "dist", "build", ".turbo",
    "coverage", ".cache", "out", ".vercel", "storybook-static",
    "__pycache__", ".venv", "venv", "env",
  ]);

  const files: SourceFile[] = [];

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 6 || files.length >= maxFiles) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && SOURCE_EXT.has(extname(entry.name))) {
          const fullPath = join(dir, entry.name);
          try {
            const s = await stat(fullPath);
            if (s.size > 200_000) continue;
            const content = await readFile(fullPath, "utf-8");
            files.push({ path: relative(projectPath, fullPath), content });
          } catch {
            // unreadable — skip
          }
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
