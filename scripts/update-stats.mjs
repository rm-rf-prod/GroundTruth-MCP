#!/usr/bin/env node
/**
 * Computes live project stats from source and updates README badges/prose.
 * Also sweeps the repo for stale version strings when called via npm version.
 *
 * Counts:
 *   - Audit patterns  : `category:` entries in src/tools/audit.ts
 *   - Tools           : `register*Tool(` calls in src/index.ts
 *   - Audit categories: unique category values in src/tools/audit.ts
 *   - Test files      : *.test.ts count under src/
 *   - Tests           : vitest json output (numTotalTests)
 *   - Library badge   : REGISTRY_BADGE_SIZE in src/constants.ts
 *
 * Called by:
 *   npm run update-stats         (manual)
 *   npm version X.Y.Z            (via version lifecycle — also sweeps version strings)
 *   prepublishOnly               (auto before every publish)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf-8");
}

function write(rel, content) {
  writeFileSync(join(root, rel), content, "utf-8");
}

function countMatches(content, re) {
  return (content.match(re) || []).length;
}

const SCAN_SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "scripts"]);
const SCAN_EXTENSIONS = new Set([".ts", ".mts", ".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".txt"]);
const SCAN_SKIP_FILES = new Set(["package-lock.json", "CHANGELOG.md"]);

function findSourceFiles(dir, results = []) {
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

function findTestFiles(dir, results = []) {
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

// ── Version sweep (only when invoked via npm version lifecycle) ────────────────

const oldVersion = process.env.npm_old_version;
const newVersion = process.env.npm_new_version;

if (oldVersion && newVersion && oldVersion !== newVersion) {
  const files = findSourceFiles(".");
  let swept = 0;
  for (const rel of files) {
    const abs = join(root, rel);
    const before = readFileSync(abs, "utf-8");
    const after = before.replaceAll(oldVersion, newVersion);
    if (after !== before) {
      writeFileSync(abs, after, "utf-8");
      swept++;
    }
  }
  if (swept > 0) console.log(`version sweep: ${oldVersion} → ${newVersion} (${swept} file${swept === 1 ? "" : "s"})`);
}

// ── Compute stats ─────────────────────────────────────────────────────────────

const auditTs = read("src/tools/audit.ts");
const patternCount = countMatches(auditTs, /^\s+category:\s+"/gm);
const categories = [...new Set((auditTs.match(/category:\s+"([^"]+)"/g) || []).map(m => m.match(/"([^"]+)"/)[1]))];
const categoryCount = categories.length;

const indexTs = read("src/index.ts");
const toolCount = countMatches(indexTs, /register\w+Tool\s*\(/g);

const testFiles = findTestFiles("src");
const testFileCount = testFiles.length;

// Library badge size — count from private registry if available, fall back to constants.ts
const privateRegistryPath = join(root, "docs/private/registry.ts");
let libraryBadgeSize;
if (existsSync(privateRegistryPath)) {
  const privateReg = readFileSync(privateRegistryPath, "utf-8");
  libraryBadgeSize = countMatches(privateReg, /^\s+id:\s+"/gm);
} else {
  const constantsTs = read("src/constants.ts");
  const badgeMatch = constantsTs.match(/REGISTRY_BADGE_SIZE\s*=\s*(\d+)/);
  libraryBadgeSize = badgeMatch ? parseInt(badgeMatch[1]) : 97;
}

// Test count — run vitest with json reporter
let testCount = 0;
const statsFile = join(root, ".vitest-stats.json");
try {
  execSync(`npx vitest run --reporter=json --outputFile="${statsFile}" 2>/dev/null`, {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (existsSync(statsFile)) {
    const stats = JSON.parse(readFileSync(statsFile, "utf-8"));
    testCount = stats.numTotalTests ?? 0;
    try { (await import("fs")).unlinkSync(statsFile); } catch { /* best effort */ }
  }
} catch {
  for (const file of testFiles) {
    const content = read(file);
    testCount += countMatches(content, /^\s+(?:it|test)\s*\(/gm);
  }
}

// ── Update README ─────────────────────────────────────────────────────────────

let readme = read("README.md");

// Badge URLs
readme = readme.replace(
  /https:\/\/img\.shields\.io\/badge\/libraries-[^"']+-teal/g,
  `https://img.shields.io/badge/libraries-${libraryBadgeSize}%2B-teal`,
);
readme = readme.replace(
  /https:\/\/img\.shields\.io\/badge\/audit_patterns-[^"']+-red/g,
  `https://img.shields.io/badge/audit_patterns-${patternCount}%2B-red`,
);
readme = readme.replace(
  /https:\/\/img\.shields\.io\/badge\/tests-\d+-brightgreen/g,
  `https://img.shields.io/badge/tests-${testCount}-brightgreen`,
);

// Alt text on badges
readme = readme.replace(/alt="\d+\+ libraries"/g, `alt="${libraryBadgeSize}+ libraries"`);
readme = readme.replace(/alt="\d+\+ audit patterns"/g, `alt="${patternCount}+ audit patterns"`);
readme = readme.replace(/alt="\d+ tests"/g, `alt="${testCount} tests"`);

// Prose: "Six tools." / "Nine tools." etc.
const toolWord = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten"][toolCount] ?? `${toolCount}`;
readme = readme.replace(
  /^(Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) tools\./m,
  `${toolWord} tools.`,
);

// Prose counts
readme = readme.replace(/\b\d+\+\s+patterns\b/g, `${patternCount}+ patterns`);
readme = readme.replace(/\ball\s+\d+\+\s+patterns\b/g, `all ${patternCount}+ patterns`);
readme = readme.replace(/\b\d+\+\s+libraries\b/g, `${libraryBadgeSize}+ libraries`);
readme = readme.replace(/Coverage is \d+\+ libraries/, `Coverage is ${libraryBadgeSize}+ libraries`);
readme = readme.replace(/\b\d+\+\s+curated\b/g, `${libraryBadgeSize}+ curated`);
readme = readme.replace(/all \d+ categories\b/g, `all ${categoryCount} categories`);
readme = readme.replace(/\d+ categories, file:line/g, `${categoryCount} categories, file:line`);
readme = readme.replace(/\d+ tests across \d+ files/, `${testCount} tests across ${testFileCount} files`);

write("README.md", readme);

// Keep REGISTRY_BADGE_SIZE in constants.ts in sync with actual private registry count
const currentConstants = read("src/constants.ts");
const updatedConstants = currentConstants.replace(
  /REGISTRY_BADGE_SIZE\s*=\s*\d+/,
  `REGISTRY_BADGE_SIZE = ${libraryBadgeSize}`,
);
if (updatedConstants !== currentConstants) {
  write("src/constants.ts", updatedConstants);
}

console.log(`stats: ${libraryBadgeSize}+ libraries | ${patternCount} patterns | ${categoryCount} categories | ${toolCount} tools | ${testCount} tests (${testFileCount} files)`);
