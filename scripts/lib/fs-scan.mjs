import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function read(rel) {
  return readFileSync(join(root, rel), "utf-8");
}

export function write(rel, content) {
  writeFileSync(join(root, rel), content, "utf-8");
}

export function countMatches(content, re) {
  return (content.match(re) || []).length;
}

// .github excluded: workflows pin their own action versions (e.g. upload-artifact
// @v7.0.0) which the version sweep must not rewrite to the gt-mcp version.
const SCAN_SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".github", "scripts"]);
const SCAN_EXTENSIONS = new Set([".ts", ".mts", ".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".txt"]);
const SCAN_SKIP_FILES = new Set(["package-lock.json", "CHANGELOG.md"]);

export function findSourceFiles(dir, results = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SCAN_SKIP_DIRS.has(entry.name)) findSourceFiles(join(dir, entry.name), results);
    } else if (
      SCAN_EXTENSIONS.has(extname(entry.name)) &&
      !SCAN_SKIP_FILES.has(entry.name)
    ) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

export function findTestFiles(dir, results = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const skip = ["node_modules", "dist", "coverage", ".git"];
    if (entry.isDirectory() && !skip.includes(entry.name)) {
      findTestFiles(join(dir, entry.name), results);
    } else if (entry.name.endsWith(".test.ts")) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}
