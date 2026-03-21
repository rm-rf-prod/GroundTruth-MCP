#!/usr/bin/env node
/**
 * Creates a GitHub release for the current package version.
 *
 * Extracts the release notes from the current version's CHANGELOG.md section
 * and passes them to `gh release create`.
 *
 * Called by: npm version X.Y.Z (via postversion hook)
 */

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const tag = `v${version}`;

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf-8");

// Extract the section for this version: from "## [X.Y.Z]" to the next "## [" or end of file
const sectionRe = new RegExp(
  `## \\[${version.replace(/\./g, "\\.")}\\][^\n]*\n([\\s\\S]*?)(?=\n## \\[|$)`,
);
const match = changelog.match(sectionRe);
const notes = match ? match[1].trim().replace(/\n---\s*$/, "").trim() : `Release ${tag}`;

const notesFile = join(tmpdir(), `gt-release-${Date.now()}.txt`);
writeFileSync(notesFile, notes, "utf-8");
try {
  execFileSync("gh", ["release", "create", tag, "--title", tag, "--notes-file", notesFile], {
    cwd: root,
    stdio: "inherit",
  });
} finally {
  try { unlinkSync(notesFile); } catch {}
}
