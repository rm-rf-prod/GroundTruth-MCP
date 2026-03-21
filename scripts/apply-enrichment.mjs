#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";

const REGISTRY_PATH = "docs/private/registry.ts";
const dataFile = process.argv[2];
if (!dataFile) {
  console.error("Usage: node scripts/apply-enrichment.mjs <data.json>");
  process.exit(1);
}

const enrichments = JSON.parse(readFileSync(dataFile, "utf-8"));
let content = readFileSync(REGISTRY_PATH, "utf-8");
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

writeFileSync(REGISTRY_PATH, content, "utf-8");
console.log(`Applied: ${applied}, Skipped: ${skipped}`);
