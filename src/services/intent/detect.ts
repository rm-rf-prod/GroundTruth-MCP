import { NOISE_PHRASES, FUNCTION_WORDS, ECOSYSTEM_WORDS } from "../../sources/intent-hints.js";
import { tokenize } from "./library-detect.js";

export { detectLibrary } from "./library-detect.js";

const MAX_TOPIC = 200;

/** Removes invocation noise ("use gt", "please") but keeps the caller's casing. */
export function removeNoise(query: string): string {
  let s = query.trim();
  for (const re of NOISE_PHRASES) {
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

export function stripNoise(query: string): string {
  return removeNoise(query).toLowerCase();
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
    /\babout\s+([\w./@:()#+-]+(?:\s+[\w./@:()#+-]+){0,4})/i,
    /\bregarding\s+([\w./@-]+(?:\s+[\w./@-]+){0,4})/i,
    /['"]([^'"]{3,60})['"]/,
    /\b(?:for|on|re:?)\s+([\w\s./@:()#+-]{3,60})/i,
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

/**
 * What the query is about once the library name, the matched hint phrases,
 * ecosystem words and filler are removed — the topic when no about/for marker
 * names one ("clean up subscription useEffect"). Keeps the caller's casing.
 */
export function residualTopic(raw: string, phrases: readonly string[]): string | undefined {
  const tokens = tokenize(removeNoise(raw));
  const lower = tokens.map((t) => t.toLowerCase());
  const drop = lower.map((t) => FUNCTION_WORDS.has(t) || ECOSYSTEM_WORDS.has(t));
  for (const phrase of phrases) {
    const words = tokenize(phrase.toLowerCase());
    for (let i = 0; words.length > 0 && i + words.length <= lower.length; i++) {
      if (words.every((w, j) => lower[i + j] === w)) words.forEach((_, j) => (drop[i + j] = true));
    }
  }
  // Cut at a word boundary: target tools cap topic/pattern at 300 chars.
  const rest = tokens.filter((_, i) => !drop[i]).join(" ");
  const capped = rest.length > MAX_TOPIC ? rest.slice(0, MAX_TOPIC + 1).replace(/\s+\S*$/, "") : rest;
  return capped.length >= 2 ? capped : undefined;
}
