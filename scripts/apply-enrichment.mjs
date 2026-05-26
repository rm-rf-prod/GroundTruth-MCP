#!/usr/bin/env node

import { readFileSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, extname, sep } from "node:path";

const REGISTRY_PATH = "docs/private/registry.ts";

/**
 * Resolve a user-supplied path safely:
 *  - confine to allowed root (default: cwd)
 *  - reject symlink escapes via realpath
 *  - allowlist extension
 *  - reject non-regular files (device, fifo, socket)
 */
function safeResolveInput(rawPath, { allowedRoot, allowedExt }) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error("Path must be a non-empty string");
  }
  if (rawPath.includes("\0")) {
    throw new Error("Path contains NUL byte");
  }

  const baseReal = realpathSync(allowedRoot);
  const candidateAbs = isAbsolute(rawPath) ? rawPath : resolve(baseReal, rawPath);

  let resolvedReal;
  try {
    resolvedReal = realpathSync(candidateAbs);
  } catch (err) {
    throw new Error(`Cannot resolve path: ${err.message}`);
  }

  const rel = relative(baseReal, resolvedReal);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error(`Path escapes allowed root: ${resolvedReal}`);
  }

  if (extname(resolvedReal).toLowerCase() !== allowedExt) {
    throw new Error(`Only ${allowedExt} files allowed`);
  }

  const st = statSync(resolvedReal);
  if (!st.isFile()) {
    throw new Error("Path is not a regular file");
  }

  return resolvedReal;
}

const dataFileArg = process.argv[2];
if (!dataFileArg) {
  console.error("Usage: node scripts/apply-enrichment.mjs <data.json>");
  process.exit(1);
}

let dataFile;
try {
  dataFile = safeResolveInput(dataFileArg, {
    allowedRoot: process.cwd(),
    allowedExt: ".json",
  });
} catch (err) {
  console.error(`Refusing to read ${dataFileArg}: ${err.message}`);
  process.exit(1);
}

const registryPath = safeResolveInput(REGISTRY_PATH, {
  allowedRoot: process.cwd(),
  allowedExt: ".ts",
});

const enrichments = JSON.parse(readFileSync(dataFile, "utf-8"));
let content = readFileSync(registryPath, "utf-8");
let applied = 0;
let skipped = 0;

for (const [id, data] of Object.entries(enrichments)) {
  const idEscaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Find the entry block: from id to the closing },
  const blockRegex = new RegExp(
    `(\\s*id: "${idEscaped}",[\\s\\S]*?)(\\n\\s*\\},)`,
  );

  const match = content.match(blockRegex);
  if (!match) {
    skipped++;
    continue;
  }

  const entryBody = match[1];
  const closing = match[2];
  let additions = "";

  if (data.bestPracticesPaths && !entryBody.includes("bestPracticesPaths")) {
    additions += `\n    bestPracticesPaths: ${JSON.stringify(data.bestPracticesPaths)},`;
  }
  if (data.urlPatterns && !entryBody.includes("urlPatterns")) {
    additions += `\n    urlPatterns: ${JSON.stringify(data.urlPatterns)},`;
  }

  if (additions) {
    content = content.replace(match[0], entryBody + additions + closing);
    applied++;
  } else {
    skipped++;
  }
}

writeFileSync(registryPath, content, "utf-8");
console.log(`Applied: ${applied}, Skipped: ${skipped}`);
