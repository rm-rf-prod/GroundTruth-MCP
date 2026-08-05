import { STOP_WORDS, VERSION_TOKEN, TOPIC_SYNONYMS, META_TOKENS } from "../sources/topic-synonyms.js";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => (VERSION_TOKEN.test(w) ? w.length >= 1 : w.length > 2) && !STOP_WORDS.has(w));
}
/**
 * A topic token plus the vocabulary docs use for the same idea. Used by the
 * evidence gate so a page reached via synonym expansion ("upgrade guide" for a
 * "migration" query) is not then failed for never containing the literal word.
 */
export function tokenVariants(token: string): string[] {
  return [token, ...(TOPIC_SYNONYMS[token] ?? [])];
}

/** Expand topic tokens with documentation-vocabulary synonyms (discovery only). */
export function expandTopicTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const s of TOPIC_SYNONYMS[t] ?? []) out.add(s);
  }
  return [...out];
}
/** Topic tokens that carry subject meaning — meta words dropped unless nothing else remains. */
export function substantiveTokens(topic: string): string[] {
  const raw = [...new Set(tokenize(topic))];
  const substantive = raw.filter((t) => !META_TOKENS.has(t));
  return substantive.length > 0 ? substantive : raw;
}
