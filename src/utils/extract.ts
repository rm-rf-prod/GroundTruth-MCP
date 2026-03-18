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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreSection(section: Section, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  const headingTokens = tokenize(section.heading);
  // Score up to 2000 chars of content (was 500 — gives far better signal)
  const contentTokens = tokenize(section.content.slice(0, 2000));
  let score = 0;

  for (const qt of queryTokens) {
    if (headingTokens.includes(qt)) score += 10;
    // Exact token match + substring match (catches e.g. "hooks" matching "hook")
    const exactMatches = contentTokens.filter((t) => t === qt).length;
    const substringMatches = contentTokens.filter((t) => t !== qt && t.includes(qt)).length;
    score += Math.min(exactMatches, 8) * 2;
    score += Math.min(substringMatches, 3) * 1;
  }

  // Boost sections with code blocks (more likely to be practical docs)
  if (section.content.includes("```")) score += 3;

  return score;
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
 * Returns at most `tokenLimit` tokens of the most relevant content.
 */
export function extractRelevantContent(
  content: string,
  topic: string,
  tokenLimit = DEFAULT_TOKEN_LIMIT,
): { text: string; truncated: boolean } {
  const charLimit = tokenLimit * CHARS_PER_TOKEN;

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

  // Score all sections
  for (const section of sections) {
    section.score = scoreSection(section, queryTokens);
  }

  // Sort by score desc, but keep preamble/overview first if it has a score
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
