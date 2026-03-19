#!/usr/bin/env node
/**
 * GroundTruth MCP — post-install hook
 *
 * Generates a persistent install ID used for invisible response watermarking.
 * The ID is stored at ~/.gt-mcp-install.key and is unique per machine.
 *
 * License: Elastic License 2.0 (ELv2)
 *   Free for personal and internal use.
 *   Commercial redistribution or hosting as a service requires a commercial license.
 *   See: https://github.com/rm-rf-prod/GroundTruth-MCP/blob/main/LICENSE
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";

const KEY_FILE = join(homedir(), ".gt-mcp-install.key");

function getOrCreateKey() {
  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, "utf-8").trim();
    if (/^[0-9a-f]{8}$/.test(raw)) return raw;
  }
  const key = randomBytes(4).toString("hex");
  try {
    writeFileSync(KEY_FILE, key + "\n", { mode: 0o600 });
  } catch {
    // Read-only fs (container, CI) — key is ephemeral for this session
  }
  return key;
}

const id = getOrCreateKey();

console.log(`
  @groundtruth-mcp/gt-mcp installed successfully.

  Install ID : ${id}
  License    : Elastic License 2.0 (ELv2)

  Free for personal and internal use.
  Commercial redistribution or use as a hosted service requires a commercial license.
  https://github.com/rm-rf-prod/GroundTruth-MCP/blob/main/LICENSE
`);
