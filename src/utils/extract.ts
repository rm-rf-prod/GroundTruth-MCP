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

// Version tokens (15, v16, 3.0) are short but high-signal for migration /
// changelog queries — they must survive tokenization to match version headings.
const VERSION_TOKEN = /^v?\d+(?:\.\d+)*$/;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => (VERSION_TOKEN.test(w) ? w.length >= 1 : w.length > 2) && !STOP_WORDS.has(w));
}

// Documentation sites rarely use the same word the caller does: an upgrade
// guide answers a "migration" query, an "optimization" page answers
// "performance". Expansion is used for LINK/URL DISCOVERY only — evidence
// verification stays literal so verdicts never inflate.
const TOPIC_SYNONYMS: Record<string, readonly string[]> = {
  migration: ["upgrade", "upgrading", "migrate", "migrating"],
  migrate: ["upgrade", "migration", "upgrading"],
  upgrade: ["migration", "upgrading", "migrate"],
  upgrading: ["migration", "upgrade"],
  performance: ["optimization", "optimizing", "optimize", "profiling"],
  optimization: ["performance", "optimizing"],
  auth: ["authentication"],
  authentication: ["auth"],
  caching: ["cache"],
  cache: ["caching"],
  config: ["configuration", "configuring"],
  configuration: ["config"],
  deploy: ["deployment", "deploying"],
  deployment: ["deploy", "deploying"],
  routing: ["router", "routes", "route", "navigation"],
  router: ["routing", "routes"],
  notifications: ["notification", "push"],
  notification: ["notifications"],
  worklets: ["worklet"],
  worklet: ["worklets"],
  testing: ["test", "tests"],
  errors: ["error"],
  error: ["errors"],
};

/** Expand topic tokens with documentation-vocabulary synonyms (discovery only). */
export function expandTopicTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const s of TOPIC_SYNONYMS[t] ?? []) out.add(s);
  }
  return [...out];
}

// Query-meta words describe the KIND of answer wanted, not its subject — they
// appear on virtually every docs page, so counting them as topic coverage lets
// entirely off-topic content pass ("Postgres RLS best practices" matching a
// web-perf page on "best practices"). Filtered from evidence/quality scoring;
// kept when they are ALL the caller gave us.
const META_TOKENS = new Set([
  "best", "practices", "practice", "latest", "guide", "guides", "tips",
  "docs", "documentation", "pattern", "patterns", "overview", "current",
]);

/** Topic tokens that carry subject meaning — meta words dropped unless nothing else remains. */
export function substantiveTokens(topic: string): string[] {
  const raw = [...new Set(tokenize(topic))];
  const substantive = raw.filter((t) => !META_TOKENS.has(t));
  return substantive.length > 0 ? substantive : raw;
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
  tokenCache: Map<Section, { headingTokens: string[]; contentTokens: string[] }>,
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
function buildIDF(
  sections: Section[],
  queryTokens: string[],
  tokenCache: Map<Section, { headingTokens: string[]; contentTokens: string[] }>,
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

function parseSections(content: string): Section[] {
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
  const tokenCache = new Map<Section, { headingTokens: string[]; contentTokens: string[] }>();
  for (const s of sections) {
    tokenCache.set(s, {
      headingTokens: tokenize(s.heading),
      contentTokens: tokenize(s.content.slice(0, 3000)),
    });
  }

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

/**
 * Parse the major version integer from a version string.
 * "15" -> 15, "v15.2.0" -> 15, "v3" -> 3. Returns undefined when no
 * version-like number is present or it looks like a calendar year (>= 1000),
 * which guards against parsing dates ("2026") as versions.
 */
export function parseMajor(version?: string): number | undefined {
  if (!version) return undefined;
  const m = /v?(\d{1,4})/i.exec(version.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n >= 1000) return undefined;
  return n;
}

/** Extract candidate major versions referenced in a single heading line. */
function headingVersions(heading: string): number[] {
  const out: number[] = [];
  const re = /\bv?(\d{1,3})(?:\.\d+)*\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(heading)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n < 1000) out.push(n);
  }
  return out;
}

/**
 * Slice a documentation / changelog blob down to the section band relevant to a
 * version upgrade. Sections are delimited by markdown headings (# .. ###); a
 * section is kept when any version referenced in its heading falls inside the
 * inclusive [fromMajor, toMajor] band. Heading-less sub-sections inherit the
 * include state of the preceding versioned heading, so nested content under an
 * in-band heading survives and content under an out-of-band heading is dropped.
 *
 * This is the core fix for the gt_migration P0: without it, a "Next.js 15 -> 16"
 * query returned v8-v11 ancient sections because every historical "Upgrading..."
 * heading scored well on a version-blind BM25 pass. When neither bound is given,
 * or no versioned heading matches the band, the original content is returned
 * unchanged so callers never receive an empty result.
 */
export function sliceVersionBand(
  content: string,
  fromVersion?: string,
  toVersion?: string,
): string {
  const fromMajor = parseMajor(fromVersion);
  const toMajor = parseMajor(toVersion);
  if (fromMajor === undefined && toMajor === undefined) return content;

  const lowBound = fromMajor ?? toMajor ?? -Infinity;
  const highBound = toMajor ?? Infinity;

  interface Seg {
    versions: number[];
    lines: string[];
  }
  const segs: Seg[] = [];
  let current: Seg | null = null;
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const h = inFence ? null : /^(#{1,3})\s+(.+)/.exec(line);
    if (h) {
      if (current) segs.push(current);
      current = { versions: headingVersions(h[2] ?? ""), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { versions: [], lines: [line] };
    }
  }
  if (current) segs.push(current);

  let lastInclude = false;
  let anyVersionedInclude = false;
  const kept: string[] = [];
  for (const seg of segs) {
    let include: boolean;
    if (seg.versions.length > 0) {
      include = seg.versions.some((v) => v >= lowBound && v <= highBound);
      lastInclude = include;
      if (include) anyVersionedInclude = true;
    } else {
      include = lastInclude;
    }
    if (include) kept.push(seg.lines.join("\n"));
  }

  // No versioned section matched — return the original so we never blank out
  // content for docs that use a non-version heading structure.
  if (!anyVersionedInclude) return content;
  return kept.join("\n").trim();
}
