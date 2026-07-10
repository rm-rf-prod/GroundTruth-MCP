import { substantiveTokens } from "./extract.js";

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

export interface EvidenceSource {
  url: string;
  sourceType?: string;
  fetchedAt?: string;
}

const MAX_OCCURRENCES_PER_TOKEN = 50;

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

  const lower = prose.toLowerCase();
  const headings = (prose.match(/^#{1,4}\s+.+$/gm) ?? []).join("\n").toLowerCase();
  // Code blocks keep their URLs — `curl https://api.x.com/webhooks` is real
  // topic evidence, unlike nav hrefs. Extract from the ORIGINAL content.
  const code = (content.match(/```[\s\S]*?```/g) ?? []).join("\n").toLowerCase();

  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];
  let occurrences = 0;

  for (const token of tokens) {
    let idx = 0;
    let count = 0;
    while (count < MAX_OCCURRENCES_PER_TOKEN) {
      idx = lower.indexOf(token, idx);
      if (idx === -1) break;
      count++;
      idx += token.length;
    }
    if (count > 0) matchedTokens.push(token);
    else missingTokens.push(token);
    occurrences += count;
  }

  const matchRatio = matchedTokens.length / tokens.length;
  const topicInHeading = tokens.some((t) => headings.includes(t));
  const topicInCode = tokens.some((t) => code.includes(t));

  const depthSignal = occurrences >= 3 || topicInHeading || topicInCode;
  const ok = tokens.length === 1 ? depthSignal : matchRatio >= 0.5 && depthSignal;

  return { ok, matchRatio, occurrences, matchedTokens, missingTokens, topicInHeading, topicInCode };
}

/**
 * Provenance + verification footer appended to every successful content
 * response. Makes the answer auditable: where it came from, when it was
 * fetched, and how strongly it covers the requested topic.
 */
export function buildEvidenceBlock(opts: {
  sources: EvidenceSource[];
  topic?: string;
  check?: EvidenceCheck;
  escalated?: boolean;
}): string {
  const { sources, topic, check, escalated } = opts;
  const seen = new Set<string>();
  const uniqueSources = sources.filter((s) => {
    if (!s.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  }).slice(0, 8);

  const lines: string[] = ["", "---", "", "## Evidence"];
  lines.push(`- Fetched live ${new Date().toISOString().slice(0, 10)} from official sources — not from model training data`);
  for (const s of uniqueSources) {
    const meta: string[] = [];
    if (s.sourceType) meta.push(s.sourceType);
    if (s.fetchedAt) meta.push(`fetched ${s.fetchedAt.slice(0, 10)}`);
    lines.push(`- Source: ${s.url}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}`);
  }
  if (topic && check) {
    const signals: string[] = [];
    if (check.topicInHeading) signals.push("headings");
    if (check.topicInCode) signals.push("code blocks");
    const where = signals.length > 0 ? `, present in ${signals.join(" + ")}` : "";
    lines.push(
      `- Topic coverage: ${check.matchedTokens.length}/${check.matchedTokens.length + check.missingTokens.length} terms, ${check.occurrences} occurrence${check.occurrences === 1 ? "" : "s"}${where}`,
    );
    if (check.missingTokens.length > 0) {
      lines.push(`- Terms not found in source: ${check.missingTokens.join(", ")}`);
    }
  }
  if (escalated) {
    lines.push("- Retrieval: topic-targeted deep fetch (initial page lacked sufficient topic evidence)");
  }
  return lines.join("\n");
}

/** Pull the first markdown headings out of content — used to show what a source DOES cover. */
export function extractHeadingOutline(content: string, max = 8): string[] {
  const headings = content.match(/^#{1,4}\s+.+$/gm) ?? [];
  return headings
    .map((h) => h.replace(/^#+\s+/, "").trim())
    .filter((h) => h.length > 0 && h.length < 90)
    .slice(0, max);
}

/**
 * Explicit "no evidence" response. Replaces the old behavior of silently
 * returning a doc's intro sections when the topic never appears — the model
 * receives a truthful miss with what WAS checked and what to do next,
 * instead of plausible-looking but off-topic content.
 */
export function buildHonestMiss(opts: {
  subject: string;
  topic: string;
  tried: string[];
  outline?: string[];
  nextSteps?: string[];
}): string {
  const { subject, topic, tried, outline, nextSteps } = opts;
  const seen = new Set<string>();
  const uniqueTried = tried.filter((t) => {
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  }).slice(0, 10);

  const lines: string[] = [
    `# ${subject} — no topic-specific evidence found`,
    "",
    `The fetched documentation does not cover "${topic}" with verifiable depth. Rather than return generic content, here is exactly what was checked:`,
    "",
    "**Sources checked:**",
    ...uniqueTried.map((u) => `- ${u}`),
  ];

  if (outline && outline.length > 0) {
    lines.push("", "**What the fetched documentation DOES cover:**", ...outline.map((h) => `- ${h}`));
  }

  const steps = nextSteps ?? [
    `Re-run with a broader or differently-worded topic`,
    `Try gt_search with a freeform query combining the library name and "${topic}"`,
    `Try gt_snippets for code-level examples`,
  ];
  lines.push("", "**What to try next:**", ...steps.map((s) => `- ${s}`));

  return lines.join("\n");
}
