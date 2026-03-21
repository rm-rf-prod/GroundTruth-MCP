#!/usr/bin/env node

/**
 * URL Health Check — validates that all curated documentation URLs are reachable.
 * Run: node scripts/check-urls.mjs
 * Used in CI (weekly scheduled job) to detect dead links before users hit them.
 */

import { readFileSync } from "fs";

const BP_FILE = "src/tools/best-practices.ts";
const SEARCH_FILE = "src/tools/search.ts";

function extractUrls(content) {
  const urlRegex = /https?:\/\/[^\s"',)}\]]+/g;
  const matches = content.match(urlRegex) || [];
  return [...new Set(matches)].filter(
    (u) =>
      !u.includes("example.com") &&
      !u.includes("localhost") &&
      !u.includes("127.0.0.1") &&
      !u.endsWith(".") &&
      !u.endsWith(","),
  );
}

async function checkUrl(url, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "GroundTruth-URLCheck/1.0" },
    });
    clearTimeout(id);
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    clearTimeout(id);
    return { url, status: 0, ok: false, error: err.message };
  }
}

async function main() {
  const bpContent = readFileSync(BP_FILE, "utf-8");
  const searchContent = readFileSync(SEARCH_FILE, "utf-8");

  const bpUrls = extractUrls(bpContent);
  const searchUrls = extractUrls(searchContent);
  const allUrls = [...new Set([...bpUrls, ...searchUrls])];

  console.log(`Checking ${allUrls.length} URLs...\n`);

  const CONCURRENCY = 10;
  const results = [];

  for (let i = 0; i < allUrls.length; i += CONCURRENCY) {
    const batch = allUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((url) => checkUrl(url)));
    results.push(...batchResults);
  }

  const dead = results.filter((r) => !r.ok);
  const alive = results.filter((r) => r.ok);

  console.log(`Alive: ${alive.length}`);
  console.log(`Dead/Error: ${dead.length}\n`);

  if (dead.length > 0) {
    console.log("Dead URLs:");
    for (const r of dead) {
      console.log(`  ${r.status || "TIMEOUT"} ${r.url}${r.error ? ` (${r.error})` : ""}`);
    }
    process.exit(1);
  }

  console.log("All URLs are reachable.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
