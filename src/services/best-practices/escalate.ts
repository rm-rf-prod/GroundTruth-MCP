import { deepFetchForTopic } from "../deep-fetch.js";
import { isIndexContent } from "../fetcher.js";
import { extractRelevantContent } from "../../utils/extract.js";
import { checkEvidence, type EvidenceCheck } from "../../utils/evidence.js";
import { sanitizeContent } from "../../utils/sanitize.js";

export interface EscalationInput {
  text: string;
  sourceUrl: string;
  truncated: boolean;
  sourceType: string;
  topic: string;
  docsUrl: string;
  tokens: number;
  bestPracticesPaths?: string[] | undefined;
}

export interface EscalationResult {
  text: string;
  sourceUrl: string;
  truncated: boolean;
  sourceType: string;
  evidence: EvidenceCheck;
  escalated: boolean;
  extraSource?: { url: string; sourceType: string };
}

/**
 * Verify the extracted output actually covers the topic, and force one
 * topic-targeted deep fetch when it does not. Escalation also fires when the
 * "content" is still a link index — a directory page can pass token checks via
 * link text while answering nothing. The deeper result is only adopted when it
 * is measurably better, so a failed escalation never degrades the answer.
 */
export async function escalateWeakEvidence(input: EscalationInput): Promise<EscalationResult> {
  const { topic, docsUrl, tokens, bestPracticesPaths } = input;
  const evidence = checkEvidence(input.text, topic);
  const base: EscalationResult = {
    text: input.text,
    sourceUrl: input.sourceUrl,
    truncated: input.truncated,
    sourceType: input.sourceType,
    evidence,
    escalated: false,
  };

  if (!topic || (evidence.ok && !isIndexContent(input.text))) return base;

  const deeper = await deepFetchForTopic(
    { content: input.text, url: input.sourceUrl, sourceType: "deep-fetch" },
    topic,
    docsUrl,
    bestPracticesPaths,
    undefined,
    true,
  );
  const result: EscalationResult = { ...base, escalated: true };
  if (deeper.url !== input.sourceUrl) {
    result.extraSource = { url: deeper.url, sourceType: deeper.sourceType };
  }

  const reExtract = extractRelevantContent(sanitizeContent(deeper.content), topic, tokens);
  const reCheck = checkEvidence(reExtract.text, topic);
  const wasIndex = isIndexContent(input.text);
  const improved =
    reCheck.ok || reCheck.occurrences > evidence.occurrences || (wasIndex && !isIndexContent(reExtract.text));
  const regressedToIndex = isIndexContent(reExtract.text) && !wasIndex;

  if (improved && !regressedToIndex) {
    result.text = reExtract.text;
    result.sourceUrl = deeper.url;
    result.truncated = reExtract.truncated;
    result.evidence = reCheck;
    result.sourceType = deeper.sourceType;
  }
  return result;
}
