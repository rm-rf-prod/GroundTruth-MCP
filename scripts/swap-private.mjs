#!/usr/bin/env node
/**
 * Swaps private registry and search files into src/ before build.
 * Reverts them after build completes (or on failure).
 *
 * Called by: prepublishOnly (via npm run build:publish)
 *
 * Flow:
 *   1. Back up public src/sources/registry.ts and src/tools/search.ts
 *   2. Copy docs/private/registry.ts -> src/sources/registry.ts
 *   3. Copy docs/private/search.ts -> src/tools/search.ts
 *   4. Signal success so the caller can proceed with build
 *
 * The revert script (revert-private.mjs) restores the backups.
 */

import { copyFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SWAPS = [
  {
    private: "docs/private/registry.ts",
    public: "src/sources/registry.ts",
    backup: "src/sources/registry.ts.pub",
  },
  {
    private: "docs/private/search.ts",
    public: "src/tools/search.ts",
    backup: "src/tools/search.ts.pub",
  },
];

for (const { private: priv, public: pub, backup } of SWAPS) {
  const privPath = join(root, priv);
  const pubPath = join(root, pub);
  const backupPath = join(root, backup);

  if (!existsSync(privPath)) {
    console.log(`swap: ${priv} not found — skipping (public registry will be used)`);
    continue;
  }

  copyFileSync(pubPath, backupPath);
  copyFileSync(privPath, pubPath);
  console.log(`swap: ${pub} <- ${priv}`);
}
