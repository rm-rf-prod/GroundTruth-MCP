import { CHARS_PER_TOKEN, DEFAULT_TOKEN_LIMIT } from "../constants.js";

interface Section {
  heading: string;
  content: string;
  level: number;
  score: number;
}

// Common English stop words that add no signal to section relevance scoring
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its",
  "may", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "let",
  "man", "put", "say", "she", "too", "use", "from", "that", "this", "they",
  "will", "with", "have", "more", "when", "what", "your", "just", "also",
  "into", "some", "than", "then", "them", "were", "been", "than", "each",
  "which", "their", "there", "would", "about", "these", "other", "after",
  "first", "could", "where", "being", "those", "before", "should",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

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
function bm25Score(
  section: Section,
  queryTokens: string[],
  idf: Map<string, number>,
  avgDocLen: number,
): number {
  if (queryTokens.length === 0) return 0;

  const k1 = 1.5; // term saturation constant
  const b = 0.75; // length normalisation constant

  const headingTokens = tokenize(section.heading);
  const contentTokens = tokenize(section.content.slice(0, 3000));
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

  // Code block bonus — only if the code contains a query token (higher bar)
  const codeBlocks = section.content.match(/```[\s\S]*?```/g) ?? [];
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
function buildIDF(sections: Section[], queryTokens: string[]): Map<string, number> {
  const N = sections.length;
  const df = new Map<string, number>();

  for (const qt of queryTokens) {
    let count = 0;
    for (const section of sections) {
      const tokens = tokenize(section.heading + " " + section.content.slice(0, 3000));
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

function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const headingMatch = /^(#{1,4})\s+(.+)/.exec(line);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        heading: headingMatch[2] ?? "",
        content: "",
        level: headingMatch[1]?.length ?? 1,
        score: 0,
      };
    } else if (current) {
      current.content += line + "\n";
    } else {
      // Content before first heading — treat as preamble
      current = { heading: "(overview)", content: line + "\n", level: 0, score: 0 };
    }
  }
  if (current) sections.push(current);
  return sections;
}

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

  // Compute average document length for BM25 length normalisation
  const avgDocLen =
    sections.reduce((sum, s) => sum + tokenize(s.content.slice(0, 3000)).length, 0) /
    Math.max(sections.length, 1);

  // Build IDF weights across all sections
  const idf = buildIDF(sections, queryTokens);

  // Score all sections with BM25
  for (const section of sections) {
    section.score = bm25Score(section, queryTokens, idf, avgDocLen);
  }

  // Sort by score desc
  const sorted = [...sections].sort((a, b) => b.score - a.score);

  // Build output greedily up to charLimit
  const picked: Section[] = [];
  let used = 0;

  for (const section of sorted) {
    const sectionText = section.heading
      ? `## ${section.heading}\n${section.content}`
      : section.content;

    if (used + sectionText.length > charLimit) {
      if (picked.length === 0) {
        // Must include at least one section — truncate it
        picked.push(section);
        used += sectionText.length;
      }
      break;
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

  const finalText = resultText.slice(0, charLimit);
  return { text: finalText, truncated: content.length > charLimit };
}
