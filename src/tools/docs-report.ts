import type { FetchResult } from "../types.js";
import { isIndexContent } from "../services/fetcher.js";
import { buildEvidenceBlock, buildHonestMiss, extractHeadingOutline, type EvidenceCheck } from "../utils/evidence.js";
import { withNotice } from "../utils/guard.js";
import { computeQualityScore } from "../utils/quality.js";

export interface DocsReportInput {
  libraryId: string;
  displayName: string;
  topic: string;
  version: string | undefined;
  text: string;
  safe: string;
  truncated: boolean;
  fetchResult: FetchResult;
  evidence: EvidenceCheck;
  escalated: boolean;
  sourcesTried: Array<{ url: string; sourceType?: string; fetchedAt?: string }>;
}

export interface DocsResponse {
  response: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent: Record<string, unknown>;
  };
  /** Whether the call produced usable content — feeds the resolveRate telemetry. */
  resolved: boolean;
}

function summarize(input: DocsReportInput): Record<string, unknown> {
  const { evidence, topic, escalated } = input;
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

/**
 * Hard miss: the topic never appears in anything fetched — or appears once in
 * passing, with no heading and no code, after escalation already ran. Both are
 * the "generic answer" failure mode: the model cannot tell a real answer from a
 * page that merely name-drops the term.
 */
function renderMiss(input: DocsReportInput, barelyMentioned: boolean): DocsResponse {
  const { libraryId, displayName, topic, version, fetchResult, sourcesTried, safe, text } = input;
  const missText = buildHonestMiss({
    subject: displayName,
    topic,
    tried: sourcesTried.map((s) => s.url),
    outline: extractHeadingOutline(safe),
  });
  return {
    response: {
      content: [{ type: "text", text: withNotice(missText) }],
      structuredContent: {
      libraryId,
      displayName,
      topic,
      version: version ?? null,
      sourceUrl: fetchResult.url,
      sourceType: fetchResult.sourceType,
      truncated: false,
      qualityScore: 0,
      qualityHints: ["No topic-specific evidence found in any fetched source"],
      evidence: summarize(input),
      sourcesTried: sourcesTried.map((s) => s.url),
      content: missText,
      // The one passing mention is still available to a client that wants it —
      // the TEXT response stays an honest miss so a model reading only that
      // cannot mistake a name-drop for an answer.
        ...(barelyMentioned ? { weakContent: text } : {}),
      },
    },
    resolved: false,
  };
}

export function renderDocs(input: DocsReportInput): DocsResponse {
  const { libraryId, displayName, topic, version, text, truncated, fetchResult, evidence, escalated, sourcesTried } = input;

  const barelyMentioned =
    !evidence.ok && evidence.occurrences <= 1 && !evidence.topicInHeading && !evidence.topicInCode;
  if (topic && (evidence.matchRatio === 0 || barelyMentioned)) return renderMiss(input, barelyMentioned);

  // Version-aware scoring: a pinned request whose content never names the target
  // version collapses below the trust threshold and says so, instead of scoring
  // ~0.9 on content from a different release.
  const { score: qualityScore, hints: qualityHints } = computeQualityScore(
    text,
    topic,
    fetchResult.sourceType,
    version ? [version] : undefined,
  );

  const header = [
    `# ${displayName} Documentation`,
    `> Source: ${fetchResult.sourceType} — ${fetchResult.url}`,
    topic ? `> Topic: ${topic}` : "",
    topic && isIndexContent(text) ? "> Note: This is a documentation INDEX (link list), not the answer itself — fetch the linked pages that match your topic." : "",
    truncated ? "> Note: Response truncated. Use a more specific topic or increase tokens." : "",
    topic && !evidence.ok ? `> Evidence: Weak — topic terms appear only sparsely (${evidence.occurrences} occurrence${evidence.occurrences === 1 ? "" : "s"}). Verify against the source before relying on this.` : "",
    qualityScore < 0.4 ? `> Quality: Low — ${qualityHints.join("; ") || "try a more specific topic or different library ID."}` : "",
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
    response: {
      content: [{ type: "text", text: withNotice(header + text + evidenceBlock) }],
      structuredContent: {
      libraryId,
      displayName,
      topic,
      version: version ?? null,
      sourceUrl: fetchResult.url,
      sourceType: fetchResult.sourceType,
      contentHash: fetchResult.contentHash,
      fetchedAt: fetchResult.fetchedAt,
      truncated,
      qualityScore,
      qualityHints,
      evidence: summarize(input),
        content: text,
      },
    },
    resolved: text.length > 200,
  };
}
