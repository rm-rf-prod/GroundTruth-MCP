import { read, write } from "./fs-scan.mjs";

const TOOL_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** Rewrite README badges, alt text and prose counts from live stats. */
export function updateReadme(stats) {
  const { libraryBadgeSize, patternCount, testCount, toolCount, categoryCount, testFileCount } = stats;
  let readme = read("README.md");

  // Badge URLs
  readme = readme.replace(
    /https:\/\/img\.shields\.io\/badge\/libraries-[^"']+-teal/g,
    `https://img.shields.io/badge/libraries-${libraryBadgeSize}%2B-teal`,
  );
  readme = readme.replace(
    /https:\/\/img\.shields\.io\/badge\/audit_patterns-[^"']+-red/g,
    `https://img.shields.io/badge/audit_patterns-${patternCount}%2B-red`,
  );
  readme = readme.replace(
    /https:\/\/img\.shields\.io\/badge\/tests-\d+-brightgreen/g,
    `https://img.shields.io/badge/tests-${testCount}-brightgreen`,
  );

  // Alt text on badges
  readme = readme.replace(/alt="\d+\+ libraries"/g, `alt="${libraryBadgeSize}+ libraries"`);
  readme = readme.replace(/alt="\d+\+ audit patterns"/g, `alt="${patternCount}+ audit patterns"`);
  readme = readme.replace(/alt="\d+ tests"/g, `alt="${testCount} tests"`);

  // Prose: "Six tools." / "Nine tools." etc.
  const toolWord = TOOL_WORDS[toolCount] ?? `${toolCount}`;
  readme = readme.replace(
    /^(Zero|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) tools\./m,
    `${toolWord} tools.`,
  );

  // Comparison-table cell + tools badge — the prose regex above only matches a
  // sentence at line start, not the "| N specialized tools |" cell.
  readme = readme.replace(/\| \d+ specialized tools \|/, `| ${toolCount} specialized tools |`);
  readme = readme.replace(/https:\/\/img\.shields\.io\/badge\/tools-\d+-blue/g, `https://img.shields.io/badge/tools-${toolCount}-blue`);
  readme = readme.replace(/alt="\d+ tools"/g, `alt="${toolCount} tools"`);

  // Prose counts
  readme = readme.replace(/\b\d+\+\s+patterns\b/g, `${patternCount}+ patterns`);
  readme = readme.replace(/\ball\s+\d+\+\s+patterns\b/g, `all ${patternCount}+ patterns`);
  readme = readme.replace(/\b\d+\+\s+libraries\b/g, `${libraryBadgeSize}+ libraries`);
  readme = readme.replace(/Coverage is \d+\+ libraries/, `Coverage is ${libraryBadgeSize}+ libraries`);
  readme = readme.replace(/\b\d+\+\s+curated\b/g, `${libraryBadgeSize}+ curated`);
  readme = readme.replace(/all \d+ categories\b/g, `all ${categoryCount} categories`);
  readme = readme.replace(/\d+ categories, file:line/g, `${categoryCount} categories, file:line`);
  readme = readme.replace(/\d+ tests across \d+ files/, `${testCount} tests across ${testFileCount} files`);

  write("README.md", readme);
}

/**
 * Keep REGISTRY_BADGE_SIZE + TOOL_COUNT in constants.ts in sync — both are
 * derived values, so adding a tool or registry entry never needs a manual edit.
 */
export function updateConstants(stats) {
  const current = read("src/constants.ts");
  let updated = current.replace(/REGISTRY_BADGE_SIZE\s*=\s*\d+/, `REGISTRY_BADGE_SIZE = ${stats.libraryBadgeSize}`);
  updated = updated.replace(/TOOL_COUNT\s*=\s*\d+/, `TOOL_COUNT = ${stats.toolCount}`);
  if (updated !== current) write("src/constants.ts", updated);
}
