#!/usr/bin/env node

/**
 * Registry Enrichment Script
 * Adds bestPracticesPaths and urlPatterns to all entries that are missing them.
 * Uses smart defaults based on docsUrl domain and common doc framework patterns.
 */

import { readFileSync, writeFileSync } from "fs";

import { URL_PATTERN_MAP, BP_PATH_MAP } from "./lib/registry-doc-maps.mjs";
const REGISTRY_PATH = "docs/private/registry.ts";


const content = readFileSync(REGISTRY_PATH, "utf-8");
let modified = content;
let bpAdded = 0;
let urlPatAdded = 0;

const entryRegex = /(\s*\{\s*\n\s*id:\s*"([^"]+)"[\s\S]*?docsUrl:\s*"([^"]+)"[\s\S]*?)(\s*\},)/g;
let m;
const replacements = [];

while ((m = entryRegex.exec(content)) !== null) {
  const fullBlock = m[0];
  const entryBody = m[1];
  const id = m[2];
  const docsUrl = m[3];
  const closing = m[4];

  if (id.startsWith("mdn/") || id.startsWith("owasp/") || id.startsWith("auth/") || id.startsWith("security/") || id.startsWith("web/")) continue;

  let additions = "";

  // Add bestPracticesPaths if missing
  if (!fullBlock.includes("bestPracticesPaths")) {
    let hostname;
    try { hostname = new URL(docsUrl).hostname; } catch { continue; }

    const bpPaths = BP_PATH_MAP[hostname];
    if (bpPaths) {
      additions += `    bestPracticesPaths: ${JSON.stringify(bpPaths)},\n`;
      bpAdded++;
    }
  }

  // Add urlPatterns if missing
  if (!fullBlock.includes("urlPatterns")) {
    let hostname;
    try { hostname = new URL(docsUrl).hostname; } catch { continue; }

    const patterns = URL_PATTERN_MAP[hostname];
    if (patterns) {
      additions += `    urlPatterns: ${JSON.stringify(patterns)},\n`;
      urlPatAdded++;
    }
  }

  if (additions) {
    const newBlock = entryBody + additions + closing;
    replacements.push({ old: fullBlock, new: newBlock });
  }
}

// Apply replacements in reverse order to preserve positions
for (const r of replacements.reverse()) {
  modified = modified.replace(r.old, r.new);
}

writeFileSync(REGISTRY_PATH, modified, "utf-8");
console.log(`Added bestPracticesPaths to ${bpAdded} entries`);
console.log(`Added urlPatterns to ${urlPatAdded} entries`);

