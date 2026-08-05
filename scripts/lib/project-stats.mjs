import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { root, read, countMatches, findTestFiles } from "./fs-scan.mjs";

/**
 * Live counts derived from source. Paths follow the module layout: the audit
 * rule table lives in src/sources, tool registration in src/server.
 */
export function computeStats() {
  const auditPatterns = read("src/sources/audit-patterns.ts");
  const patternCount = countMatches(auditPatterns, /^\s+category:\s+"/gm);
  const categories = [
    ...new Set((auditPatterns.match(/category:\s+"([^"]+)"/g) || []).map((m) => m.match(/"([^"]+)"/)[1])),
  ];

  const registerTools = read("src/server/register-tools.ts");
  const toolCount = countMatches(registerTools, /register\w+Tool\s*\(/g);

  const testFileCount = findTestFiles("src").length;

  return {
    patternCount,
    categoryCount: categories.length,
    toolCount,
    testFileCount,
    libraryBadgeSize: libraryBadgeSize(),
    testCount: runTestCount(),
  };
}

/** Count from the private registry when present, else the constants badge value. */
function libraryBadgeSize() {
  const privateRegistryPath = join(root, "docs/private/registry.ts");
  if (existsSync(privateRegistryPath)) {
    return countMatches(readFileSync(privateRegistryPath, "utf-8"), /^\s+id:\s+"/gm);
  }
  const badgeMatch = read("src/constants.ts").match(/REGISTRY_BADGE_SIZE\s*=\s*(\d+)/);
  return badgeMatch ? parseInt(badgeMatch[1]) : 97;
}

/**
 * Never write a wrong test-count badge. The old grep fallback undercounted by
 * ~14% (it cannot see table/each-generated cases), so a publish could ship a
 * stale badge. Fail instead — vitest is always available in CI and prepublish.
 */
function runTestCount() {
  const statsFile = join(root, ".vitest-stats.json");
  try {
    execSync(`npx vitest run --reporter=json --outputFile="${statsFile}" 2>/dev/null`, {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
    if (!existsSync(statsFile)) return 0;
    const stats = JSON.parse(readFileSync(statsFile, "utf-8"));
    try { unlinkSync(statsFile); } catch { /* best effort */ }
    return stats.numTotalTests ?? 0;
  } catch (err) {
    console.error("update-stats: vitest stats unavailable —", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
