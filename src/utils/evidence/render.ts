import type { EvidenceCheck } from "./match.js";

export interface EvidenceSource {
  url: string;
  sourceType?: string;
  fetchedAt?: string;
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
