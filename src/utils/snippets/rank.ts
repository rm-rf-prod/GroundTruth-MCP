import type { Snippet } from "../../types.js";
import { tokenize } from "../extract.js";
import { normalizeLanguage } from "./extract.js";

function buildSnippetIDF(snippets: Snippet[], queryTokens: string[]): Map<string, number> {
  const N = Math.max(snippets.length, 1);
  const idf = new Map<string, number>();
  for (const qt of queryTokens) {
    let df = 0;
    for (const s of snippets) {
      const tokens = tokenize(`${s.title} ${s.description} ${s.code}`);
      if (tokens.some((t) => t === qt || t.includes(qt))) df += 1;
    }
    // Robertson-Sparck-Jones IDF: rare query terms (e.g. "useEffect") outweigh
    // terms that appear in every snippet (e.g. the library name).
    idf.set(qt, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idf;
}

function scoreSnippet(snippet: Snippet, queryTokens: string[], idf: Map<string, number>): number {
  if (queryTokens.length === 0) return 1;
  const titleTokens = tokenize(snippet.title);
  const descTokens = tokenize(snippet.description);
  const codeTokens = tokenize(snippet.code);
  let score = 0;
  for (const qt of queryTokens) {
    // base 1 + IDF: never reduces a match below its prior weight, only boosts
    // discriminative terms, so matched snippets always keep score > 0.
    const w = 1 + (idf.get(qt) ?? 0);
    if (titleTokens.some((t) => t === qt)) score += 12 * w;
    else if (titleTokens.some((t) => t.includes(qt))) score += 6 * w;
    if (descTokens.includes(qt)) score += 4 * w;
    if (codeTokens.includes(qt)) score += 3 * w;
  }
  // Quality bonuses only apply when the query actually matched something — otherwise
  // every snippet would tie with score=2 and pass the "score > 0" filter.
  if (score > 0) {
    if (snippet.language && snippet.language !== "text") score += 1;
    if (snippet.description.length > 0) score += 1;
  }
  return score;
}

/**
 * Rank snippets by topic relevance and optional language filter.
 * Snippets with score 0 are dropped unless topic is empty.
 */
export function rankSnippets(
  snippets: Snippet[],
  topic: string,
  language?: string,
  max = 10,
): Snippet[] {
  const filtered = language
    ? snippets.filter((s) => s.language === normalizeLanguage(language))
    : snippets;

  const queryTokens = tokenize(topic);
  const idf = buildSnippetIDF(filtered, queryTokens);

  const scored = filtered.map((s) => ({
    ...s,
    score: scoreSnippet(s, queryTokens, idf),
  }));

  const ranked = queryTokens.length === 0
    ? scored
    : scored.filter((s) => s.score > 0);

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, max);
}

/**
 * Render snippets as a markdown response (one entry per snippet) plus a structured
 * representation suitable for tool output's structuredContent field.
 */
export function renderSnippets(snippets: Snippet[]): string {
  if (snippets.length === 0) {
    return "No matching snippets found. Try a broader topic or remove the language filter.";
  }
  const lines: string[] = [`Found ${snippets.length} snippet${snippets.length > 1 ? "s" : ""}.`, ""];
  for (const s of snippets) {
    lines.push(`### ${s.title}`);
    if (s.description) lines.push(s.description);
    lines.push(`Language: \`${s.language}\``);
    lines.push("");
    lines.push("```" + s.language);
    lines.push(s.code);
    lines.push("```");
    lines.push(`Source: ${s.source}`);
    lines.push("");
  }
  return lines.join("\n");
}
