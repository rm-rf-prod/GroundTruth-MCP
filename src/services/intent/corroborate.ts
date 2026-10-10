/**
 * Evidence that an alias made of ordinary words ("click", "rich", "next") is
 * used as a library name in this query rather than as plain English.
 */
import {
  GENERIC_WORDS,
  FUNCTION_WORDS,
  INTENT_WORDS,
  LIBRARY_ANCHORS,
  ECOSYSTEM_WORDS,
} from "../../sources/intent-hints.js";
import { lookupByAlias } from "../../sources/registry.js";
import type { LibraryEntry } from "../../types.js";
import type { Hit } from "./library-detect.js";

const VERSION = /^v?\d+(?:\.\d+)*(?:\.x)?$/;
// Plural-insensitive compare: "lockfile" matches "lockfiles", "class" keeps its "ss".
const stem = (w: string): string => w.replace(/(?<!s)s$/, "");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const vocabCache = new WeakMap<LibraryEntry, Set<string>>();

/** Distinctive words from an entry's own metadata ("lockfiles" for uv, "markdown" for marked). */
function entryVocabulary(entry: LibraryEntry): Set<string> {
  let vocab = vocabCache.get(entry);
  if (!vocab) {
    const words = [entry.name, entry.description, ...entry.tags, ...entry.aliases]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9+#]+/);
    vocab = new Set(words.filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w) && !FUNCTION_WORDS.has(w)).map(stem));
    vocabCache.set(entry, vocab);
  }
  return vocab;
}

/** Written as a name in the original query: `quoted`, or Capitalised mid-sentence. */
function namedInRaw(raw: string, words: string[]): boolean {
  const body = words.map(escapeRe).join("[\\s_-]+");
  if (new RegExp(`[\`'"]${body}[\`'"]`, "i").test(raw)) return true;
  for (const m of raw.matchAll(new RegExp(`(?<![\\w])${body}(?![\\w])`, "gi"))) {
    const first = m[0].charAt(0);
    if (first === first.toLowerCase()) continue;
    const before = raw.slice(0, m.index).trimEnd();
    if (before !== "" && !/[.!?:]$/.test(before)) return true;
  }
  return false;
}

/** Checks that do not depend on where the alias sits, so they are memoised per phrase. */
function contextSupports(hit: Hit, tokens: string[], raw: string): boolean {
  // A multi-word alias that extends one of the entry's own names is a product
  // name ("ray serve", "effect-ts").
  const parts = hit.words.flatMap((w) => w.split("-"));
  if (parts.length > 1 && parts.some((p) => lookupByAlias(p) === hit.entry)) return true;

  const own = new Set(hit.words);
  const others = tokens.filter((t) => !own.has(t));
  const languages = hit.entry.language;
  if (others.some((t) => ECOSYSTEM_WORDS.get(t)?.some((l) => languages.includes(l)))) return true;

  const content = others.filter((t) => !FUNCTION_WORDS.has(t));
  if (content.length > 0 && content.every((t) => INTENT_WORDS.has(t))) return true;

  const vocab = entryVocabulary(hit.entry);
  const ownStems = new Set(hit.words.map(stem));
  if (content.some((t) => t.length >= 3 && !GENERIC_WORDS.has(t) && !ownStems.has(stem(t)) && vocab.has(stem(t)))) {
    return true;
  }
  return namedInRaw(raw, hit.words);
}

/**
 * Builds a check for one query: true when the query gives an ordinary-word
 * alias a reason to be read as a name — a registered brand-plus-qualifier
 * phrase ("ray serve", "fetch api"), an ecosystem word that matches the entry's
 * language, an adjacent "library"/"package" anchor, a version number, a
 * distinctive word from the entry's own metadata, name-style writing in the raw
 * query, or nothing else but request words ("docs for spring", "what's new in
 * next"). Memoised per entry and phrase, so a repeated word stays linear.
 */
export function corroborator(tokens: string[], raw: string): (hit: Hit) => boolean {
  const memo = new Map<string, boolean>();
  return (hit) => {
    const end = hit.start + hit.words.length;
    if (LIBRARY_ANCHORS.has(tokens[hit.start - 1] ?? "") || LIBRARY_ANCHORS.has(tokens[end] ?? "")) return true;
    if (VERSION.test(tokens[end] ?? "") || VERSION.test(tokens[end + 1] ?? "")) return true;
    const key = `${hit.entry.id} ${hit.words.join(" ")}`;
    let supported = memo.get(key);
    if (supported === undefined) memo.set(key, (supported = contextSupports(hit, tokens, raw)));
    return supported;
  };
}
