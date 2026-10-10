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
/**
 * Terms tokenize() cannot represent, lower-cased: identifiers it splits apart
 * (select_related, vi.mock, tokio::spawn, invalidateQueries, @theme) and short
 * acronyms it drops (KV, S3, D1). Read from the RAW topic, because tokenize()
 * strips the very punctuation and case that mark them.
 */
export function topicIdentifiers(topic: string): string[] {
  const ids = (topic.match(/@[\w-]+|[@\w.:]+[._:][\w.:]+|\b[a-z]+[A-Z]\w*/g) ?? [])
    .map((m) => m.replace(/[.:]+$/, ""))
    // Version strings (15.1, v4.x) are not identifiers; docs write them many ways.
    // Nor are library names (Next.js, Vue.js): their own docs mostly say "Next", "Vue".
    .filter((m) => !/^v?\d/i.test(m) && !/^[a-z][\w-]*\.(?:js|ts)$/i.test(m));
  const acronyms = (topic.match(/\b[A-Za-z0-9]{2}\b/g) ?? [])
    .filter((m) => (/\d/.test(m) || m === m.toUpperCase()) && !/^v?\d+$/i.test(m));
  return [...new Set([...ids, ...acronyms].map((m) => m.toLowerCase()))];
}

/**
 * Stems of the words inside camelCase identifiers (invalidateQueries ->
 * invalidat, quer). tokenize() glues them into one token that matches only
 * verbatim, so "Invalidations from Mutations" looked no closer than any other
 * mutation page. Link ranking uses these to break ties, nothing more.
 */
export function identifierStems(topic: string): string[] {
  const words = (topic.match(/\b[a-z]+[A-Z]\w*/g) ?? []).join(" ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return [...new Set(tokenize(words).map((w) => w.replace(/(?:e|es|s|ies)$/, "")))].filter((w) => w.length >= 4);
}

/** Topic tokens that carry subject meaning — meta words dropped unless nothing else remains. */
export function substantiveTokens(topic: string): string[] {
  const raw = [...new Set(tokenize(topic))];
  const substantive = raw.filter((t) => !META_TOKENS.has(t));
  return substantive.length > 0 ? substantive : raw;
}
