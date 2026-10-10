import { fuzzySearch } from "../../sources/registry.js";
import { GENERIC_WORDS, FUNCTION_WORDS } from "../../sources/intent-hints.js";
import { detectLibrary, residualTopic } from "../intent/detect.js";
import type { LibraryEntry } from "../../types.js";

export interface RegistryMatch {
  id: string;
  /** The query with the library's own words removed — what to look up in its docs. */
  topic: string;
}

const isExactly = (entry: LibraryEntry, phrase: string): boolean =>
  [entry.id, entry.name, ...entry.aliases].some((n) => n.toLowerCase() === phrase);

/**
 * Same weak-word rule as library-detect.ts: an alias made only of ordinary words
 * ("rich", "next", "tracing") is plain English unless the query writes it as a
 * name — quoted, dotted, scoped, or capitalised mid-sentence ("Rich text editor"
 * opens a sentence, so it stays a word).
 */
function isPlainWords(raw: string, atStart: boolean): boolean {
  if (/[./@"'`]/.test(raw) || /[A-Z]/.test(atStart ? raw.slice(1) : raw)) return false;
  return raw
    .toLowerCase()
    .split(/[\s_-]+/)
    .every((p) => p === "" || GENERIC_WORDS.has(p) || FUNCTION_WORDS.has(p));
}

/**
 * Registry libraries a freeform query names. fuzzySearch scores the WHOLE query
 * as a substring of a name or alias, so "supabase row level security" matched
 * nothing. When it finds nothing, a word pair or single word that is exactly a
 * library name or alias picks the library, and the other words become the topic.
 */
export function registryMatches(query: string): RegistryMatch[] {
  // gt_dispatch's detector first: it ranks a library over the language it is
  // written in, so "rust tokio spawn a task" is tokio, not the Rust book.
  const named = detectLibrary(query);
  if (named) return [{ id: named.id, topic: residualTopic(query, [named.surface]) ?? query }];
  const whole = fuzzySearch(query, 3);
  if (whole.length > 0) return whole.map((e) => ({ id: e.id, topic: query }));
  const words = query.split(/[\s,]+/).filter(Boolean);
  for (const n of [2, 1]) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      if (isPlainWords(slice.join(" "), i === 0)) continue;
      const phrase = slice.map((w) => w.replace(/^["'`]+|["'`]+$/g, "")).join(" ").toLowerCase();
      // 90 = exact alias score; the exactness check drops stacked partial hits.
      const entry = fuzzySearch(phrase, 3, 90).find((e) => isExactly(e, phrase));
      if (entry) {
        const rest = [...words.slice(0, i), ...words.slice(i + n)].join(" ");
        return [{ id: entry.id, topic: rest || query }];
      }
    }
  }
  return [];
}
