#!/usr/bin/env node
/**
 * Reverts the private registry swap — restores public files from backups.
 * Always runs after build, whether it succeeded or failed.
 */

import { copyFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BACKUPS = [
  { backup: "src/sources/registry.ts.pub", target: "src/sources/registry.ts" },
  { backup: "src/tools/search.ts.pub", target: "src/tools/search.ts" },
];

for (const { backup, target } of BACKUPS) {
  const backupPath = join(root, backup);
  const targetPath = join(root, target);

  if (!existsSync(backupPath)) continue;

  copyFileSync(backupPath, targetPath);
  unlinkSync(backupPath);
  console.log(`revert: ${target} restored`);
}
