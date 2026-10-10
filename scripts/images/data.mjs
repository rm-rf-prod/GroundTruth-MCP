// Every number drawn in an image is read here, from source, at render time.
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { root, read, countMatches } from "../lib/fs-scan.mjs";

// Raw `language:` values -> one ecosystem label. TS and JS share npm, so they are one ecosystem.
const ECOSYSTEM = {
  typescript: "JavaScript / TypeScript",
  javascript: "JavaScript / TypeScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  scala: "Scala",
  agnostic: "Language-agnostic",
  c: "C / C++",
  cpp: "C / C++",
  "c++": "C / C++",
  csharp: "C#",
  css: "CSS",
  html: "HTML",
  php: "PHP",
  ruby: "Ruby",
  elixir: "Elixir",
  swift: "Swift",
  dart: "Dart",
  sql: "SQL",
  yaml: "YAML",
  json: "JSON",
  bash: "Shell",
};
const ecosystemOf = (lang) => ECOSYSTEM[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);

export function loadStats() {
  const registry = read("src/sources/registry.ts");
  const libraries = countMatches(registry, /^\s+id:\s+"/gm);
  const langLists = [...registry.matchAll(/^\s+language:\s*\[([^\]]*)\]/gm)].map((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].toLowerCase()),
  );
  if (libraries === 0 || langLists.length !== libraries) {
    throw new Error(`registry parse mismatch: ${libraries} ids vs ${langLists.length} language arrays`);
  }

  const perLibrary = langLists.map((langs) => new Set(langs.map(ecosystemOf)));
  const counts = new Map();
  for (const set of perLibrary) for (const eco of set) counts.set(eco, (counts.get(eco) ?? 0) + 1);
  const ecosystems = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const auditSource = read("src/sources/audit-patterns.ts");
  const auditPatterns = countMatches(auditSource, /^\s+category:\s+"/gm);
  const auditCategories = new Set([...auditSource.matchAll(/category:\s+"([^"]+)"/g)].map((m) => m[1])).size;

  const toolCount = countMatches(read("src/server/register-tools.ts"), /register\w+Tool\s*\(/g);
  const toolNames = toolNamesFromSource();
  if (toolNames.length !== toolCount) {
    throw new Error(`tool mismatch: register-tools.ts registers ${toolCount}, src/tools declares ${toolNames.length}`);
  }

  const version = JSON.parse(read("package.json")).version;
  return { libraries, ecosystems, perLibrary, auditPatterns, auditCategories, toolCount, toolNames, version };
}

/** Tool names as declared by `server.registerTool("gt_...")` in src/tools, alphabetical. */
function toolNamesFromSource() {
  const dir = join(root, "src/tools");
  const names = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    for (const m of readFileSync(join(dir, f), "utf-8").matchAll(/registerTool\(\s*"(gt_\w+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Top `n` ecosystems (extended to keep ties together) plus one "Other" row
 * counting libraries that belong to any remaining ecosystem.
 */
export function topEcosystems(stats, n = 14) {
  let cut = Math.min(n, stats.ecosystems.length);
  while (cut < stats.ecosystems.length && stats.ecosystems[cut].count === stats.ecosystems[cut - 1].count) cut++;
  const top = stats.ecosystems.slice(0, cut);
  const rest = stats.ecosystems.slice(cut);
  if (rest.length === 0) return top;
  const restLabels = new Set(rest.map((e) => e.label));
  const otherCount = stats.perLibrary.filter((set) => [...set].some((e) => restLabels.has(e))).length;
  return [...top, { label: `Other (${rest.length})`, count: otherCount, other: true, members: rest }];
}

/** Validates the --bench file so a typo fails loudly instead of drawing a wrong chart. */
export function loadBench(file) {
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`--bench ${file}: cannot read JSON (${err instanceof Error ? err.message : err})`);
  }
  const metrics = json?.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) throw new Error(`--bench ${file}: "metrics" must be a non-empty array`);
  if (metrics.length > 8) throw new Error(`--bench ${file}: at most 8 metrics fit the 1600x900 layout, got ${metrics.length}`);
  metrics.forEach((m, i) => {
    const where = `--bench ${file}: metrics[${i}]`;
    if (typeof m?.label !== "string" || !m.label.trim()) throw new Error(`${where}.label must be a non-empty string`);
    for (const k of ["before", "after"]) {
      if (typeof m[k] !== "number" || !Number.isFinite(m[k]) || m[k] <= 0) throw new Error(`${where}.${k} must be a positive number`);
    }
    if (typeof m.unit !== "string") throw new Error(`${where}.unit must be a string`);
    if (m.better !== undefined && m.better !== "lower" && m.better !== "higher") throw new Error(`${where}.better must be "lower" or "higher"`);
  });
  return metrics;
}
