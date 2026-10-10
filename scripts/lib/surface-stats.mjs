import { read, write } from "./fs-scan.mjs";

/** The MCP registry rejects a longer server.json description. */
export const SERVER_JSON_DESCRIPTION_MAX = 100;

const libraryClaim = /\b\d+\+(\s+curated)?\s+libraries\b/g;

/** llms.txt count claims. Release-note prose ("expands the registry to N libraries") is history and stays. */
export function applyLlmsStats(text, stats) {
  return text
    .replace(libraryClaim, `${stats.libraryBadgeSize}+$1 libraries`)
    .replace(/^## Tools \(\d+\)$/m, `## Tools (${stats.toolCount})`)
    .replace(/\b\d+ code audit patterns across \d+ categories\b/, `${stats.patternCount} code audit patterns across ${stats.categoryCount} categories`)
    .replace(/\b\d+ tests across \d+ files\b/, `${stats.testCount} tests across ${stats.testFileCount} files`);
}

export function applyServerJsonStats(text, stats) {
  const json = JSON.parse(text);
  json.description = json.description.replace(libraryClaim, `${stats.libraryBadgeSize}+$1 libraries`);
  if (json.description.length > SERVER_JSON_DESCRIPTION_MAX) {
    throw new Error(`server.json description is ${json.description.length} chars, max ${SERVER_JSON_DESCRIPTION_MAX}: ${json.description}`);
  }
  return JSON.stringify(json, null, 2) + "\n";
}

/** Edits only the description line, so the rest of package.json keeps its formatting. */
export function applyPackageJsonStats(text, stats) {
  return text.replace(/^(\s*"description":\s*")(.*)(",?)$/m, (_line, open, description, close) =>
    `${open}${description.replace(libraryClaim, `${stats.libraryBadgeSize}+$1 libraries`)}${close}`,
  );
}

function rewrite(rel, apply, stats) {
  const before = read(rel);
  const after = apply(before, stats);
  if (after !== before) write(rel, after);
}

/** Count claims outside README: llms.txt, server.json and the package.json description. */
export function updatePublicSurfaces(stats) {
  rewrite("llms.txt", applyLlmsStats, stats);
  rewrite("server.json", applyServerJsonStats, stats);
  rewrite("package.json", applyPackageJsonStats, stats);
}
