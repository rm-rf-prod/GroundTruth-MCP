import { tokenize } from "./tokenize.js";
import type { Section, TokenCache } from "./sections.js";

/**
 * BM25-inspired section scoring.
 *
 * Key improvements over simple TF counting:
 * - IDF weighting: terms rare across the corpus rank higher
 * - TF saturation: uses BM25 k1 damping to prevent term-frequency stuffing
 * - Field-length normalisation: shorter sections aren't unfairly penalised
 * - Heading weight: matching the heading is 5x more valuable than body text
 * - Code block bonus: sections with query-matching code get a 5-point boost
 * - Adjacency bonus: sections near already-picked top sections rank higher
 */
export function bm25Score(
  section: Section,
  queryTokens: string[],
  idf: Map<string, number>,
  avgDocLen: number,
  tokenCache: TokenCache,
): number {
  if (queryTokens.length === 0) return 0;

  const k1 = 1.5; // term saturation constant
  const b = 0.75; // length normalisation constant

  // Reuse the per-section tokens computed once in extractRelevantContent —
  // avoids O(N*Q) re-tokenization. Arrays are identical to inline tokenize()
  // output, so BM25 scores are bit-for-bit unchanged.
  const cached = tokenCache.get(section)!;
  const headingTokens = cached.headingTokens;
  const contentTokens = cached.contentTokens;
  const docLen = contentTokens.length;
  const lenNorm = 1 - b + b * (docLen / Math.max(avgDocLen, 1));

  let score = 0;

  for (const qt of queryTokens) {
    const termIdf = idf.get(qt) ?? 1;

    // Heading match — high-value signal (weight x5)
    const headingHits = headingTokens.filter((t) => t === qt || t.startsWith(qt)).length;
    if (headingHits > 0) {
      const tf = (headingHits * (k1 + 1)) / (headingHits + k1 * lenNorm);
      score += termIdf * tf * 5;
    }

    // Body match — BM25 TF with length normalisation
    const exactHits = contentTokens.filter((t) => t === qt).length;
    const subHits = contentTokens.filter((t) => t !== qt && t.includes(qt)).length;
    const totalHits = exactHits + subHits * 0.5;

    if (totalHits > 0) {
      const tf = (totalHits * (k1 + 1)) / (totalHits + k1 * lenNorm);
      score += termIdf * tf;
    }
  }

  // Code block bonus — only if the code contains a query token (higher bar).
  // Cap block count + per-block size so a section with dozens of large blocks
  // cannot blow up tokenization cost; scoring is unchanged for the common case
  // (the loop already breaks on the first query match).
  const MAX_CODE_BLOCKS = 10;
  const MAX_BLOCK_CHARS = 800;
  const codeBlocks = (section.content.match(/```[\s\S]*?```/g) ?? [])
    .slice(0, MAX_CODE_BLOCKS)
    .map((blk) => blk.slice(0, MAX_BLOCK_CHARS));
  for (const block of codeBlocks) {
    const blockTokens = tokenize(block);
    const hasQueryMatch = queryTokens.some((qt) => blockTokens.includes(qt));
    if (hasQueryMatch) {
      score += 5;
      break;
    }
  }

  // Section-depth bonus: h1/h2 sections tend to be more important than deep h4s
  if (section.level <= 2) score += 1;

  return score;
}

/**
 * Build inverse document frequency map across all sections.
 * IDF = log((N - df + 0.5) / (df + 0.5) + 1)  [Robertson-Sparck Jones variant]
 */
export function buildIDF(
  sections: Section[],
  queryTokens: string[],
  tokenCache: TokenCache,
): Map<string, number> {
  const N = sections.length;
  const df = new Map<string, number>();

  for (const qt of queryTokens) {
    let count = 0;
    for (const section of sections) {
      const cached = tokenCache.get(section)!;
      // tokenize(h + " " + c) === [...tokenize(h), ...tokenize(c)] because the
      // explicit space forces a split boundary — combined list is identical.
      const tokens = [...cached.headingTokens, ...cached.contentTokens];
      if (tokens.some((t) => t === qt || t.includes(qt))) count++;
    }
    df.set(qt, count);
  }

  const idf = new Map<string, number>();
  for (const [term, docFreq] of df) {
    idf.set(term, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }
  return idf;
}
