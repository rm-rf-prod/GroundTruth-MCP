#!/usr/bin/env node
/**
 * Prepends a new changelog section to CHANGELOG.md when called via `npm version`.
 *
 * Collects git commits since the previous tag, formats them as bullet points,
 * and inserts a new `## [X.Y.Z] — YYYY-MM-DD` section at the top of the file.
 *
 * Called by: npm version X.Y.Z (via version lifecycle hook)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.env.npm_new_version ?? JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version;
const today = new Date().toISOString().slice(0, 10);

// Get commits since the previous tag
let commits = [];
try {
  const prevTag = execSync("git describe --tags --abbrev=0 HEAD 2>/dev/null || echo ''", {
    cwd: root,
    encoding: "utf-8",
  }).trim();

  const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
  const log = execSync(`git log ${range} --oneline --no-merges`, {
    cwd: root,
    encoding: "utf-8",
  }).trim();

  commits = log
    .split("\n")
    .map((line) => line.replace(/^[a-f0-9]+ /, "").trim())
    .filter(Boolean);
} catch {
  // Not a git repo or no commits — proceed with empty list
}

const bulletLines = commits.length
  ? commits.map((c) => `- ${c}`).join("\n")
  : "- See diff for changes.";

const newSection = `## [${version}] — ${today}\n\n${bulletLines}\n\n---\n\n`;

const changelogPath = join(root, "CHANGELOG.md");
const existing = readFileSync(changelogPath, "utf-8");

// Insert after the "# Changelog" header line
const updated = existing.replace(/^(# Changelog\n+)/, `$1${newSection}`);
writeFileSync(changelogPath, updated, "utf-8");

console.log(`changelog: prepended section for v${version}`);
