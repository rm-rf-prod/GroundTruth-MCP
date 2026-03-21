#!/usr/bin/env node
/**
 * Syncs SERVER_VERSION in src/constants.ts with the current package.json version.
 * Called by the `version` npm lifecycle hook (npm version X.Y.Z).
 * Replaces the fragile inline node -e backtick script that broke under sh.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version;

const constantsPath = join(root, "src/constants.ts");
const before = readFileSync(constantsPath, "utf-8");
const after = before.replace(/SERVER_VERSION = "[^"]+"/g, `SERVER_VERSION = "${version}"`);

if (after === before) {
  console.error(`update-version: WARNING — SERVER_VERSION pattern not found in constants.ts`);
  process.exit(1);
}

writeFileSync(constantsPath, after, "utf-8");
console.log(`update-version: SERVER_VERSION → ${version}`);

const serverJsonPath = join(root, "server.json");
try {
  const serverJson = JSON.parse(readFileSync(serverJsonPath, "utf-8"));
  serverJson.version = version;
  for (const pkg of serverJson.packages || []) {
    pkg.version = version;
  }
  writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + "\n", "utf-8");
  console.log(`update-version: server.json → ${version}`);
} catch {
  console.log(`update-version: server.json not found, skipping`);
}
