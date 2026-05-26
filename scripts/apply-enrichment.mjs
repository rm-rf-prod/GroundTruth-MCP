#!/usr/bin/env node

import { readFileSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { resolve, isAbsolute, extname, sep } from "node:path";

const REGISTRY_PATH = "docs/private/registry.ts";
const ALLOWED_ROOT = realpathSync(process.cwd());

function fullyDecode(input) {
  let result = String(input);
  for (let i = 0; i < 10; i++) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch {
      break;
    }
  }
  return result;
}

function safeResolveInput(rawPath, { allowedExt }) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error("Path must be a non-empty string");
  }

  const decoded = fullyDecode(rawPath);

  if (decoded.includes("\0")) {
    throw new Error("Path contains NUL byte");
  }
  if (isAbsolute(decoded)) {
    throw new Error("Absolute paths not allowed");
  }
  if (/^[a-zA-Z]:/.test(decoded)) {
    throw new Error("Drive letters not allowed");
  }
  if (decoded.startsWith("\\\\") || decoded.startsWith("//")) {
    throw new Error("UNC paths not allowed");
  }
  if (!/^[a-zA-Z0-9._/-]+$/.test(decoded)) {
    throw new Error("Path contains disallowed characters");
  }

  const candidateAbs = resolve(ALLOWED_ROOT, decoded);

  let resolvedReal;
  try {
    resolvedReal = realpathSync(candidateAbs);
  } catch (err) {
    throw new Error(`Cannot resolve path: ${err.message}`);
  }

  if (!resolvedReal.startsWith(ALLOWED_ROOT + sep)) {
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
  dataFile = safeResolveInput(dataFileArg, { allowedExt: ".json" });
} catch (err) {
  console.error(`Refusing to read ${dataFileArg}: ${err.message}`);
  process.exit(1);
}

const registryPath = safeResolveInput(REGISTRY_PATH, { allowedExt: ".ts" });

if (!dataFile.startsWith(ALLOWED_ROOT + sep)) {
  console.error("Refusing to read: data path outside project root");
  process.exit(1);
}
if (!registryPath.startsWith(ALLOWED_ROOT + sep)) {
  console.error("Refusing to read: registry path outside project root");
  process.exit(1);
}

// deepcode ignore PT: dataFile validated by safeResolveInput (decode + realpath + startsWith + extname + statSync) and re-checked above
const enrichments = JSON.parse(readFileSync(dataFile, "utf-8"));
// deepcode ignore PT: registryPath is derived from hard-coded REGISTRY_PATH constant
let content = readFileSync(registryPath, "utf-8");
let applied = 0;
let skipped = 0;

for (const [id, data] of Object.entries(enrichments)) {
  const idEscaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

// deepcode ignore PT: registryPath derived from hard-coded REGISTRY_PATH and validated above
writeFileSync(registryPath, content, "utf-8");
console.log(`Applied: ${applied}, Skipped: ${skipped}`);
