/**
 * Library mention detection over word n-grams. Exact alias lookups only — no
 * substring matching — so an ordinary phrase can no longer resolve to a library
 * whose alias, id or org merely contains one of its words ("handle" inside
 * react-native-gesture-handler, "project" inside opensearch-project).
 */
import { LIBRARY_REGISTRY, lookupByAlias } from "../../sources/registry.js";
import { GENERIC_WORDS, FUNCTION_WORDS } from "../../sources/intent-hints.js";
import type { LibraryEntry } from "../../types.js";
import { corroborator } from "./corroborate.js";

export interface DetectedLibrary {
  id: string;
  name: string;
  /** Registry key that resolved — safe to pass back as a library name. */
  alias: string;
  /** The words as they appeared in the query, for topic extraction. */
  surface: string;
}

export interface Hit {
  entry: LibraryEntry;
  key: string;
  words: string[];
  start: number;
  weak: boolean;
}

/** Longest registry alias phrase worth trying ("the swift programming language"). */
const MAX_NGRAM = 4;
const VERSION_SUFFIX = /@?v?\d+(?:\.\d+)*$/;

/** Splits on whitespace and bracket/quote punctuation; keeps ".", "-", "/", "@", "#", "+" inside names. */
export function tokenize(text: string): string[] {
  return text
    .split(/[\s,;!?()[\]{}<>|"`]+/)
    .map((t) => t.replace(/^[^\w@#+.]+|[^\w#+]+$/g, ""))
    .filter((t) => t.length > 0 && t.length <= 60);
}

const normKey = (s: string): string => s.toLowerCase().replace(/[\s._-]+/g, "");

let normIndex: Map<string, { entry: LibraryEntry; key: string }> | undefined;

/** Separator-insensitive alias lookup: "next js", "socket io" and "drizzle kit" hit their hyphen/dot forms. */
function lookupNormalized(phrase: string): { entry: LibraryEntry; key: string } | undefined {
  if (!normIndex) {
    normIndex = new Map();
    for (const e of LIBRARY_REGISTRY) {
      for (const key of [e.name, ...e.aliases, e.npmPackage, e.pypiPackage]) {
        if (!key) continue;
        const nk = normKey(key);
        // lookupByAlias keeps the registry's own precedence for shared keys.
        const owner = lookupByAlias(key);
        if (owner && nk.length >= 2 && !normIndex.has(nk)) normIndex.set(nk, { entry: owner, key: key.toLowerCase() });
      }
    }
  }
  return normIndex.get(normKey(phrase));
}

function resolvePhrase(phrase: string): { entry: LibraryEntry; key: string } | undefined {
  const exact = lookupByAlias(phrase);
  return exact ? { entry: exact, key: phrase } : lookupNormalized(phrase);
}

/** Resolves one user-supplied name ("prisma", "next.js", "react19") to a registry entry. */
export function resolveName(name: string): LibraryEntry | undefined {
  const tok = tokenize(name.toLowerCase())[0];
  if (!tok) return undefined;
  return resolvePhrase(tok)?.entry ?? resolveVersioned(tok)?.entry;
}

/** "react19", "vue3", "next@15" — a name with a version glued on. */
function resolveVersioned(tok: string): { entry: LibraryEntry; key: string } | undefined {
  const bare = tok.replace(VERSION_SUFFIX, "");
  if (bare === tok || bare.length < 3 || !/[a-z]$/.test(bare)) return undefined;
  return resolvePhrase(bare);
}

/** True when every word is ordinary vocabulary and nothing marks it as a name ("next" yes, "next.js" no). */
function isWeak(words: string[]): boolean {
  if (words.some((w) => /[./@]/.test(w))) return false;
  return words
    .flatMap((w) => w.split(/[-_]/))
    .every((p) => p === "" || GENERIC_WORDS.has(p) || FUNCTION_WORDS.has(p));
}

function collectHits(tokens: string[]): Hit[] {
  const hits: Hit[] = [];
  for (let n = Math.min(MAX_NGRAM, tokens.length); n >= 1; n--) {
    for (let start = 0; start + n <= tokens.length; start++) {
      const words = tokens.slice(start, start + n);
      const exact = resolvePhrase(words.join(" "));
      // A glued-on version ("next15") already marks the token as a name.
      const versioned = !exact && n === 1 ? resolveVersioned(words[0] as string) : undefined;
      const found = exact ?? versioned;
      if (!found) continue;
      hits.push({ entry: found.entry, key: found.key, words, start, weak: !versioned && isWeak(words) });
    }
  }
  return hits;
}

const isLanguage = (e: LibraryEntry): boolean => e.tags.includes("language");

/**
 * Detects the library a query names. Longest phrase wins, then a library over a
 * language ("rust tokio" -> tokio), then the first mention ("zod with react" ->
 * zod) unless a later name extends it ("drizzle ... drizzle-kit"). Aliases made
 * of ordinary words need corroborating context (see corroborate.ts).
 *
 * `raw` is the original query: capitalisation and quotes there count as
 * evidence that an ordinary word is used as a name ("Click", "`rich`").
 */
export function detectLibrary(text: string, raw: string = text): DetectedLibrary | null {
  const tokens = tokenize(text.toLowerCase());
  const hits = collectHits(tokens).sort(
    (a, b) =>
      b.words.length - a.words.length ||
      Number(isLanguage(a.entry)) - Number(isLanguage(b.entry)) ||
      Number(a.weak) - Number(b.weak) ||
      a.start - b.start,
  );
  const corroborated = corroborator(tokens, raw);
  const accept = (h: Hit): boolean => !h.weak || corroborated(h);
  const first = hits.find(accept);
  if (!first) return null;
  const best = hits.find((h) => h.key.startsWith(`${first.key}-`) && accept(h)) ?? first;
  return { id: best.entry.id, name: best.entry.name, alias: best.key, surface: best.words.join(" ") };
}
