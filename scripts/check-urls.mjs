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
      !u.includes("${") && // template-literal fragments, not real URLs
      !u.includes("example.com") &&
      !u.includes("localhost") &&
      !u.includes("127.0.0.1") &&
      !u.endsWith(".") &&
      !u.endsWith(","),
  );
}

async function checkUrl(url, timeout = 10000) {
  // HEAD first (cheap), GET retry second — some hosts (MDN, bot-guarded CDNs)
  // reject or time out HEAD requests while serving GET fine.
  for (const method of ["HEAD", "GET"]) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "GroundTruth-URLCheck/1.0" },
      });
      clearTimeout(id);
      if (res.ok) return { url, status: res.status, ok: true };
      if (method === "HEAD") continue;
      return { url, status: res.status, ok: false };
    } catch (err) {
      clearTimeout(id);
      if (method === "HEAD") continue;
      return { url, status: 0, ok: false, error: err.message };
    }
  }
  return { url, status: 0, ok: false };
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

  // Only permanent misses fail the job — transient timeouts/blocks/5xx would
  // make the weekly CI run flaky and train everyone to ignore it.
  const dead = results.filter((r) => !r.ok && (r.status === 404 || r.status === 410));
  const flaky = results.filter((r) => !r.ok && r.status !== 404 && r.status !== 410);
  const alive = results.filter((r) => r.ok);

  console.log(`Alive: ${alive.length}`);
  console.log(`Dead (404/410): ${dead.length}`);
  console.log(`Unreachable/blocked (warning only): ${flaky.length}\n`);

  if (flaky.length > 0) {
    console.log("Warnings (not failing):");
    for (const r of flaky) {
      console.log(`  ${r.status || "TIMEOUT"} ${r.url}${r.error ? ` (${r.error})` : ""}`);
    }
    console.log("");
  }

  if (dead.length > 0) {
    console.log("Dead URLs:");
    for (const r of dead) {
      console.log(`  ${r.status} ${r.url}`);
    }
    process.exit(1);
  }

  console.log("No dead URLs.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
