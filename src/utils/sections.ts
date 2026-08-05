import { tokenize } from "./tokenize.js";

export interface Section {
  heading: string;
  content: string;
  level: number;
  score: number;
}

/** Per-section token cache, computed once and reused by IDF and BM25 scoring. */
export type TokenCache = Map<Section, { headingTokens: string[]; contentTokens: string[] }>;

export function buildTokenCache(sections: Section[]): TokenCache {
  const cache: TokenCache = new Map();
  for (const s of sections) {
    cache.set(s, {
      headingTokens: tokenize(s.heading),
      contentTokens: tokenize(s.content.slice(0, 3000)),
    });
  }
  return cache;
}

export function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let inFence = false;

  for (const line of lines) {
    // '#' lines inside code fences are comments, not headings — splitting there
    // fragments code blocks and ships unbalanced fences to the client.
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const headingMatch = inFence ? null : /^(#{1,4})\s+(.+)/.exec(line);
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

  // If content has no markdown headings (common with Jina output), create
  // synthetic sections from paragraph blocks to enable BM25 scoring
  if (sections.length <= 1 && content.length > 2000) {
    const paragraphs = content.split(/\n{2,}/);
    if (paragraphs.length > 3) {
      const syntheticSections: Section[] = [];
      let chunk: string[] = [];
      let chunkLen = 0;

      for (const para of paragraphs) {
        chunk.push(para);
        chunkLen += para.length;

        if (chunkLen > 800 || chunk.length >= 4) {
          const text = chunk.join("\n\n");
          const firstLine = (chunk[0] ?? "").slice(0, 80).replace(/[#*_`]/g, "").trim();
          syntheticSections.push({
            heading: firstLine || "(section)",
            content: text,
            level: 2,
            score: 0,
          });
          chunk = [];
          chunkLen = 0;
        }
      }

      if (chunk.length > 0) {
        const text = chunk.join("\n\n");
        const firstLine = (chunk[0] ?? "").slice(0, 80).replace(/[#*_`]/g, "").trim();
        syntheticSections.push({
          heading: firstLine || "(section)",
          content: text,
          level: 2,
          score: 0,
        });
      }

      if (syntheticSections.length > 2) {
        return syntheticSections;
      }
    }
  }

  return sections;
}
