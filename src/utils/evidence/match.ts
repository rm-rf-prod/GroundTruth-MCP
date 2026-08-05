import { substantiveTokens, tokenVariants } from "../extract.js";

/**
 * Evidence verification layer — the "never generic" gate.
 *
 * Every content tool runs its final output through checkEvidence() before
 * returning. Content that does not demonstrably cover the requested topic
 * (token coverage + occurrence depth + heading/code presence) is either
 * escalated to a deeper fetch or replaced with an explicit honest miss —
 * it is never silently served as if it answered the question.
 */

export interface EvidenceCheck {
  /** Content passes the evidence bar for the topic */
  ok: boolean;
  /** Matched topic tokens / total topic tokens (0..1) */
  matchRatio: number;
  /** Total occurrences of topic tokens across the content (capped per token) */
  occurrences: number;
  matchedTokens: string[];
  missingTokens: string[];
  /** At least one topic token appears in a markdown heading */
  topicInHeading: boolean;
  /** At least one topic token appears inside a fenced code block */
  topicInCode: boolean;
}

const MAX_OCCURRENCES_PER_TOKEN = 50;

/**
 * Lower-case a haystack and split camelCase humps into separate words, so
 * `reportPerformance()` counts as evidence for "performance" while `urls`
 * still does not count as evidence for "rls".
 *
 * Call once per haystack; countTokenHits expects text already in this form.
 */
export function normalizeForMatching(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * Count occurrences of a topic token at a WORD START, capped.
 *
 * Plain substring counting inflated coverage on mid-word noise: "rls" matched
 * every "urls", "api" matched "rapid", "auth" matched "coauthor". Requiring the
 * match to begin at a word boundary kills that class outright while keeping
 * the morphological tolerance docs actually need — "auth" still matches
 * "authentication", "cache" still matches "cached".
 *
 * `haystack` must already be normalizeForMatching()-ed.
 */
export function countTokenHits(haystack: string, token: string): number {
  if (!token) return 0;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![a-z0-9])${esc}`, "g");
  let count = 0;
  while (count < MAX_OCCURRENCES_PER_TOKEN && re.exec(haystack) !== null) count++;
  return count;
}

/**
 * Drop markdown link targets and bare URLs so topic tokens are only counted in
 * prose/headings/code — never inside hrefs or utm params. Link TEXT is kept.
 * Shared by checkEvidence and computeQualityScore so the evidence gate and the
 * quality score can never disagree about what counts as topic coverage.
 */
export function stripUrlNoise(content: string): string {
  return content
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ");
}

/**
 * Strict topic-evidence check on FINAL output text.
 *
 * Deliberately stricter than scoreTopicRelevance (deep-fetch trigger):
 * a single passing mention of a topic word is NOT evidence — generic
 * READMEs mention everything once. Real topic coverage shows up as
 * repeated occurrences, a heading, or topic tokens inside code.
 */
export function checkEvidence(content: string, topic: string): EvidenceCheck {
  // Meta words ("best", "practices", "latest") are filtered so coverage is
  // measured on the SUBJECT — otherwise any docs page passes any query.
  const tokens = substantiveTokens(topic);
  if (tokens.length === 0) {
    return {
      ok: true,
      matchRatio: 1,
      occurrences: 0,
      matchedTokens: [],
      missingTokens: [],
      topicInHeading: false,
      topicInCode: false,
    };
  }

  // A 404 page whose nav links carry utm_campaign=docs_guides_<topic>
  // must not pass as topic coverage.
  const prose = stripUrlNoise(content);

  const lower = normalizeForMatching(prose);
  const headings = normalizeForMatching((prose.match(/^#{1,4}\s+.+$/gm) ?? []).join("\n"));
  // Code blocks keep their URLs — `curl https://api.x.com/webhooks` is real
  // topic evidence, unlike nav hrefs. Extract from the ORIGINAL content.
  const code = normalizeForMatching((content.match(/```[\s\S]*?```/g) ?? []).join("\n"));

  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];
  let occurrences = 0;

  // Each token counts if IT or the vocabulary docs use for it is present:
  // an "rls" query is answered by a page that says "row level security", and a
  // page found by expanding "migration" to "upgrade" must not then fail the
  // gate for lacking the literal word.
  const hits = (haystack: string, token: string): number =>
    Math.max(...tokenVariants(token).map((v) => countTokenHits(haystack, v)));

  for (const token of tokens) {
    const count = hits(lower, token);
    if (count > 0) matchedTokens.push(token);
    else missingTokens.push(token);
    occurrences += count;
  }

  const matchRatio = matchedTokens.length / tokens.length;
  const topicInHeading = tokens.some((t) => hits(headings, t) > 0);
  const topicInCode = tokens.some((t) => hits(code, t) > 0);

  const depthSignal = occurrences >= 3 || topicInHeading || topicInCode;
  const ok = tokens.length === 1 ? depthSignal : matchRatio >= 0.5 && depthSignal;

  return { ok, matchRatio, occurrences, matchedTokens, missingTokens, topicInHeading, topicInCode };
}
