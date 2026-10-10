/**
 * Intent router — maps a plain-text user query like "use gt mcp" or
 * "check the docs for next.js routing" to the most appropriate gt_* tool
 * with a high-confidence argument set.
 *
 * The router is intentionally heuristic, not ML-based. Every rule is a
 * deterministic, testable predicate; this matters because the rules are
 * the contract that promises "user says X → tool Y(args)".
 *
 * Used in two places:
 * 1. `gt_dispatch` tool — the smart entry point that LLM clients can call
 *    when they want gt-mcp to figure out the right action.
 * 2. Server instructions — the routing table is rendered into the MCP
 *    server.instructions string so the LLM picks the right tool directly.
 */
import { VERB_HINTS, URL_RE } from "../sources/intent-hints.js";
import type { IntentInput, IntentMatch } from "./intent/types.js";
import {
  stripNoise,
  detectLibrary,
  isProjectLevelInvocation,
  extractTopic,
  residualTopic,
} from "./intent/detect.js";
import { routeVerb } from "./intent/verb-routes.js";

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word hint matching: "vs" must not fire inside "canvas", nor
// "migration" inside "migrations" (a drizzle-kit docs question, not an upgrade).
const VERB_HINT_RES = VERB_HINTS.flatMap(({ tool, words }) =>
  words.map((word) => ({ tool, word, re: new RegExp(`(?<![\\w'])${escapeRe(word)}(?![\\w'])`) })),
);

export type { GtToolName, IntentInput, IntentMatch } from "./intent/types.js";
export { renderRoutingTable } from "./intent/routing-table.js";

/**
 * Pure routing function — given a plain-text query, return the best
 * gt_* tool + arguments. Multiple tools may match; returns the highest
 * confidence one. Always returns *something* — falls back to gt_search.
 */
export function detectIntent({ query, projectPath }: IntentInput): IntentMatch {
  const raw = query.trim();
  const text = stripNoise(raw);

  // 1. URL detection — direct gt_get_docs with the URL as libraryId
  const urlMatch = raw.match(URL_RE);
  if (urlMatch) {
    return {
      tool: "gt_get_docs",
      args: { libraryId: urlMatch[0] },
      reason: "direct URL detected — fetch docs from it",
      confidence: 0.95,
    };
  }

  // 2. Verb hints — whole-word matches, longest phrase wins
  const verbHits = VERB_HINT_RES.filter(({ re }) => re.test(text)).map(({ tool, word }) => ({ tool, word }));
  verbHits.sort((a, b) => b.word.length - a.word.length);

  const library = detectLibrary(text, raw);
  const surface = library ? [library.surface] : [];
  // An about/for topic that is only the library name ("use gt for react") says nothing.
  const explicit = extractTopic(text);
  const topic = explicit !== undefined && library && !residualTopic(explicit, surface) ? undefined : explicit;

  // 3. Resolve from verb hits; null means the verb does not apply to this query
  if (verbHits[0]) {
    const residual = residualTopic(raw, [...surface, ...verbHits.map((h) => h.word)]);
    const routed = routeVerb(verbHits[0], { raw, text, library, topic, residual, projectPath });
    if (routed) return routed;
  }

  // 4. Library mentioned, no applicable verb → best practices is the safest default
  if (library) {
    const subject = topic ?? residualTopic(raw, surface);
    return {
      tool: "gt_best_practices",
      args: { libraryId: library.id, ...(subject !== undefined ? { topic: subject } : {}) },
      reason: `library "${library.name}" mentioned, no specific verb`,
      confidence: 0.85,
    };
  }

  // 5. Empty / "use gt" / project-level → auto-scan
  if (isProjectLevelInvocation(raw)) {
    return {
      tool: "gt_auto_scan",
      args: { projectPath: projectPath ?? "." },
      reason: 'project-level invocation ("use gt", "scan this project", etc.)',
      confidence: 0.8,
    };
  }

  // 6. Final fallback: freeform search
  return {
    tool: "gt_search",
    args: { query: raw },
    reason: "no specific tool matched — defaulting to freeform search",
    confidence: 0.55,
  };
}
