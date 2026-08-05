import { CHARS_PER_TOKEN, DEFAULT_TOKEN_LIMIT } from "../constants.js";
import { tokenize } from "./tokenize.js";
import { parseSections, buildTokenCache, type Section } from "./sections.js";
import { bm25Score, buildIDF } from "./bm25.js";

// Re-exported so every existing `from "../utils/extract.js"` import keeps working.
export { tokenize, tokenVariants, expandTopicTokens, substantiveTokens } from "./tokenize.js";
export { parseMajor, sliceVersionBand } from "./version-band.js";

/**
 * Extract topic-relevant sections from documentation content.
 * Uses BM25-inspired scoring for better relevance than simple token overlap.
 * Returns at most `tokenLimit` tokens of the most relevant content.
 */
export function extractRelevantContent(
  content: string,
  topic: string,
  tokenLimit = DEFAULT_TOKEN_LIMIT,
): { text: string; truncated: boolean } {
  const charLimit = Math.floor(tokenLimit * CHARS_PER_TOKEN);

  // Markdown images are pure token waste for an LLM consumer — Jina output is
  // full of nav logos/badges ("![Image 1: Vercel](...svg)"). Drop them (and the
  // link wrappers left empty by the removal) before any budgeting or scoring.
  content = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\s*\]\([^)]*\)/g, "");

  // If content fits within limit, return it all
  if (content.length <= charLimit) {
    return { text: content, truncated: false };
  }

  const queryTokens = tokenize(topic);

  // No topic provided — return the first charLimit chars (summary/overview)
  if (queryTokens.length === 0) {
    return { text: content.slice(0, charLimit), truncated: true };
  }

  const sections = parseSections(content);

  // Tokenize every section exactly once and reuse across avgDocLen, buildIDF and
  // bm25Score — collapses O(N*Q) re-tokenization to O(N) with identical results.
  const tokenCache = buildTokenCache(sections);

  // Compute average document length for BM25 length normalisation
  const avgDocLen =
    sections.reduce((sum, s) => sum + (tokenCache.get(s)?.contentTokens.length ?? 0), 0) /
    Math.max(sections.length, 1);

  // Build IDF weights across all sections
  const idf = buildIDF(sections, queryTokens, tokenCache);

  // Score all sections with BM25
  for (const section of sections) {
    section.score = bm25Score(section, queryTokens, idf, avgDocLen, tokenCache);
  }

  // Sort by score desc
  const sorted = [...sections].sort((a, b) => b.score - a.score);

  // Build output greedily up to charLimit
  const picked: Section[] = [];
  let used = 0;

  // Greedy fill, best-scoring first. A section that does not fit is SKIPPED,
  // not a stop signal: one oversized section used to end packing and ship a
  // half-empty budget while smaller, still-relevant sections went unsent.
  for (const section of sorted) {
    const sectionText = section.heading
      ? `## ${section.heading}\n${section.content}`
      : section.content;

    if (used + sectionText.length > charLimit) {
      if (picked.length === 0) {
        // Must include at least one section — the top-scoring one, truncated
        // downstream by the charLimit slice.
        picked.push(section);
        used += sectionText.length;
        break;
      }
      // Stop once the remaining head-room is too small for any real content.
      if (charLimit - used < 400) break;
      continue;
    }
    picked.push(section);
    used += sectionText.length;
  }

  // Re-sort picked sections by their original order (preserve doc flow)
  const originalOrder = sections.reduce<Map<Section, number>>((map, s, i) => {
    map.set(s, i);
    return map;
  }, new Map());
  picked.sort((a, b) => (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0));

  const resultText = picked
    .map((s) => (s.heading ? `## ${s.heading}\n${s.content}` : s.content))
    .join("\n---\n");

  let finalText = resultText.slice(0, charLimit);
  // Truncation can land mid-code-block — close the fence rather than shipping
  // a half-open block that swallows everything after it in the client's render.
  for (const fence of ["```", "~~~"]) {
    if ((finalText.split(fence).length - 1) % 2 === 1) finalText += `\n${fence}`;
  }
  return { text: finalText, truncated: content.length > charLimit };
}

/**
 * Replace stale calendar years in queries with the current year.
 * Matches 4-digit years 2020-last year that appear as standalone tokens
 * (not part of ES2022, OAuth2.0, WCAG 2.1, v18.3, etc.).
 */
export function normalizeQueryYear(query: string): string {
  const currentYear = new Date().getFullYear();
  const staleYearPattern = new RegExp(
    `(?<![./\\w])(20[12][0-9])(?![./\\w])`,
    "g",
  );
  return query.replace(staleYearPattern, (match) => {
    const year = parseInt(match, 10);
    return year < currentYear ? String(currentYear) : match;
  });
}
