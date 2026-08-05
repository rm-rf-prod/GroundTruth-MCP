import { buildEvidenceBlock, buildHonestMiss, extractHeadingOutline, type EvidenceCheck } from "../utils/evidence.js";
import { withNotice } from "../utils/guard.js";
import { computeQualityScore } from "../utils/quality.js";

export interface ReportInput {
  displayName: string;
  resolvedId: string;
  topic: string;
  text: string;
  sourceUrl: string;
  truncated: boolean;
  sourceType: string;
  evidence: EvidenceCheck;
  escalated: boolean;
  sourcesTried: Array<{ url: string; sourceType?: string }>;
}

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}

function summarize(evidence: EvidenceCheck, topic: string, escalated: boolean): Record<string, unknown> {
  return {
    ok: evidence.ok,
    matchRatio: evidence.matchRatio,
    occurrences: evidence.occurrences,
    matchedTokens: evidence.matchedTokens,
    missingTokens: evidence.missingTokens,
    escalated,
    verdict: !topic ? "untargeted" : evidence.ok ? "strong" : evidence.matchRatio > 0 ? "weak" : "miss",
  };
}

/** Explicit "no topic-specific evidence" response — never a substituted generic page. */
function renderMiss(input: ReportInput): ToolResponse {
  const { displayName, topic, text, sourcesTried } = input;
  const missText = buildHonestMiss({
    subject: `${displayName} best practices`,
    topic,
    tried: sourcesTried.map((s) => s.url),
    outline: extractHeadingOutline(text),
    nextSteps: [
      "Re-run with a broader or differently-worded topic",
      `Try gt_search with "${displayName} ${topic}" as a freeform query`,
      "Try gt_get_docs with the same topic for reference documentation",
    ],
  });
  return {
    content: [{ type: "text", text: withNotice(missText) }],
    structuredContent: {
      libraryId: input.resolvedId,
      displayName,
      topic,
      sourceUrl: input.sourceUrl,
      truncated: false,
      qualityScore: 0,
      qualityHints: ["No topic-specific evidence found in any fetched source"],
      evidence: summarize(input.evidence, topic, input.escalated),
      sourcesTried: sourcesTried.map((s) => s.url),
      content: missText,
    },
  };
}

export function renderBestPractices(input: ReportInput): ToolResponse {
  const { displayName, topic, text, sourceUrl, truncated, sourceType, evidence, escalated, sourcesTried } = input;

  if (topic && evidence.matchRatio === 0) return renderMiss(input);

  // Real fetch-path sourceType — a hardcoded "jina" inflated the source tier
  // and let the "Quality: Low" warning silently miss fallback content.
  const { score: qualityScore, hints: qualityHints } = computeQualityScore(text, topic, sourceType);

  const header = [
    `# ${displayName} — Best Practices`,
    topic ? `> Topic: ${topic}` : "",
    `> Source: ${sourceUrl}`,
    truncated ? "> Note: Response truncated. Use a more specific topic or increase tokens." : "",
    topic && !evidence.ok ? `> Evidence: Weak — topic terms appear only sparsely (${evidence.occurrences} occurrence${evidence.occurrences === 1 ? "" : "s"}). Verify against the source before relying on this.` : "",
    qualityScore < 0.4 ? `> Quality: Low — ${qualityHints.join("; ") || "try a more specific topic."}` : "",
    "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const evidenceBlock = buildEvidenceBlock({
    sources: sourcesTried,
    topic,
    ...(topic ? { check: evidence } : {}),
    escalated,
  });

  return {
    content: [{ type: "text", text: withNotice(header + text + evidenceBlock) }],
    structuredContent: {
      libraryId: input.resolvedId,
      displayName,
      topic,
      sourceUrl,
      truncated,
      qualityScore,
      qualityHints,
      evidence: summarize(evidence, topic, escalated),
      content: text,
    },
  };
}
