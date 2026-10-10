#!/usr/bin/env node
/**
 * Computes live project stats from source and updates README badges/prose,
 * llms.txt, the server.json and package.json descriptions, and constants.ts.
 * Also sweeps the repo for stale version strings when called via npm version.
 *
 * Counts:
 *   - Audit patterns  : `category:` entries in src/sources/audit-patterns.ts
 *   - Audit categories: unique category values in the same table
 *   - Tools           : `register*Tool(` calls in src/server/register-tools.ts
 *   - Test files      : *.test.ts count under src/
 *   - Tests           : vitest json output (numTotalTests)
 *   - Libraries       : `id:` entries in src/sources/registry.ts
 *
 * Called by:
 *   npm run update-stats         (manual)
 *   npm version X.Y.Z            (via version lifecycle — also sweeps version strings)
 *   prepublishOnly               (auto before every publish)
 */

import { sweepVersions } from "./lib/version-sweep.mjs";
import { computeStats } from "./lib/project-stats.mjs";
import { updateReadme, updateConstants } from "./lib/readme-stats.mjs";
import { updatePublicSurfaces } from "./lib/surface-stats.mjs";

const swept = sweepVersions(process.env.npm_old_version, process.env.npm_new_version);
if (swept > 0) {
  console.log(
    `version sweep: ${process.env.npm_old_version} → ${process.env.npm_new_version} (${swept} file${swept === 1 ? "" : "s"})`,
  );
}

const stats = computeStats();
updateReadme(stats);
updatePublicSurfaces(stats);
updateConstants(stats);

console.log(
  `stats: ${stats.libraryBadgeSize}+ libraries | ${stats.patternCount} patterns | ` +
  `${stats.categoryCount} categories | ${stats.toolCount} tools | ` +
  `${stats.testCount} tests (${stats.testFileCount} files)`,
);
