import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { root, findSourceFiles } from "./fs-scan.mjs";

/**
 * Rewrite stale version strings across the repo when invoked via `npm version`.
 * Strict patterns only — never substring-replace, which broke CIDR comments
 * like 172.16.0.0/12.
 */
export function sweepVersions(oldVersion, newVersion) {
  if (!oldVersion || !newVersion || oldVersion === newVersion) return 0;

  // Match: v6.0.0 (with v prefix), "6.0.0" (quoted), `6.0.0` (backtick),
  // @6.0.0 (npm pin), =6.0.0 (cli flag).
  const escaped = oldVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`v${escaped}\\b`, "g"),
    new RegExp(`"${escaped}"`, "g"),
    new RegExp("`" + escaped + "`", "g"),
    new RegExp(`@${escaped}\\b`, "g"),
    new RegExp(`=${escaped}\\b`, "g"),
  ];
  const replacements = [
    `v${newVersion}`,
    `"${newVersion}"`,
    `\`${newVersion}\``,
    `@${newVersion}`,
    `=${newVersion}`,
  ];

  let swept = 0;
  for (const rel of findSourceFiles(".")) {
    const abs = join(root, rel);
    const before = readFileSync(abs, "utf-8");
    let after = before;
    for (let i = 0; i < patterns.length; i++) {
      after = after.replace(patterns[i], replacements[i]);
    }
    if (after !== before) {
      writeFileSync(abs, after, "utf-8");
      swept++;
    }
  }
  return swept;
}
