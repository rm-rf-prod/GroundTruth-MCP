import { lookupByAlias, fuzzySearch } from "../../sources/registry.js";
import { NOISE_PHRASES, FUZZY_STOP_WORDS } from "../../sources/intent-hints.js";

export function stripNoise(query: string): string {
  let s = query.toLowerCase().trim();
  for (const re of NOISE_PHRASES) {
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Detects a library mention by scanning each token against the registry alias
 * table. Returns the longest matching alias, since users say "next.js" not "next".
 */
export function detectLibrary(text: string): { id: string; name: string; alias: string } | null {
  // Multi-word aliases first (e.g. "react native", "next.js", "tailwind css")
  const phrases = [
    /\bnext\.?js\b/i,
    /\bnuxt\.?js?\b/i,
    /\breact\s+native\b/i,
    /\bnode\.?js\b/i,
    /\bvue\.?js?\b/i,
    /\btailwind\s+css\b/i,
    /\bspring\s+boot\b/i,
    /\bclaude\s+code\b/i,
    /\bclaude\s+agent\s+sdk\b/i,
  ];
  for (const re of phrases) {
    const m = text.match(re);
    if (m) {
      const alias = m[0].toLowerCase().replace(/\s+/g, " ");
      const entry = lookupByAlias(alias);
      if (entry) return { id: entry.id, name: entry.name, alias };
    }
  }

  // Single-word alias lookup against the registry
  const tokens = text.split(/[\s,]+/).filter((t) => t.length >= 2 && t.length <= 60);
  for (const tok of tokens) {
    const cleaned = tok.replace(/[^\w@/.-]/g, "");
    if (!cleaned) continue;
    const entry = lookupByAlias(cleaned);
    if (entry) return { id: entry.id, name: entry.name, alias: cleaned };
  }

  // Fuzzy fallback on the longest non-stop word
  const longest = tokens
    .filter((t) => t.length >= 4 && !FUZZY_STOP_WORDS.has(t.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (longest) {
    // minScore 20 = at least an alias-contains match; rejects tag-only (10) and
    // npm-package-contains-only (15) hits that otherwise misroute generic queries
    // ("how to build a rest api" -> a build-tool library).
    const matches = fuzzySearch(longest, 1, 20);
    if (matches[0]) return { id: matches[0].id, name: matches[0].name, alias: longest };
  }

  return null;
}

/** True if the query looks like a project-level "use gt" call (no library) */
export function isProjectLevelInvocation(query: string): boolean {
  const cleaned = stripNoise(query);
  if (cleaned.length === 0) return true;
  return /\b(?:project|here|this|my\s+code|repo|repository|codebase|app|deps?|dependencies|files?)\b/.test(cleaned);
}

/** Detect the user wants migration: from→to version mentioned */
export function extractMigrationVersions(text: string): { from?: string; to?: string } {
  const m = text.match(/\bfrom\s+(?:v?)(\d+(?:\.\d+)*)\s+to\s+(?:v?)(\d+(?:\.\d+)*)/i);
  if (m && m[1] && m[2]) return { from: m[1], to: m[2] };
  const v = text.match(/\bv?(\d+(?:\.\d+)*)\s*(?:→|->|to)\s*v?(\d+(?:\.\d+)*)/);
  if (v && v[1] && v[2]) return { from: v[1], to: v[2] };
  return {};
}

/** Extract a topic phrase after "about", "for", "on" */
export function extractTopic(text: string): string | undefined {
  // Prefer the more specific "about ..." marker — it scopes the topic
  // tightly. Fall back to "regarding", then quoted strings, then "for/on".
  const tries = [
    /\babout\s+([\w./@-]+(?:\s+[\w./@-]+){0,4})/i,
    /\bregarding\s+([\w./@-]+(?:\s+[\w./@-]+){0,4})/i,
    /['"]([^'"]{3,60})['"]/,
    /\b(?:for|on|re:?)\s+([\w\s./@-]{3,60})/i,
  ];
  for (const re of tries) {
    const m = text.match(re);
    if (m && m[1]) {
      const t = m[1].trim();
      if (t.length >= 2) return t;
    }
  }
  return undefined;
}
