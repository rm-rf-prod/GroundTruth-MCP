/**
 * Result guarantee — every gt_* tool invocation MUST return useful text to
 * the LLM client. This module formats the "we couldn't fetch X, here's what
 * to try next" fallback so the LLM is never stuck with an empty result.
 *
 * The Karpathy-style discipline: a documentation fetcher that returns
 * "failed" without telling the LLM what to do next is not enterprise-grade.
 */

import { withNotice } from "./guard.js";

export interface FallbackContext {
  displayName: string;
  attemptedSources?: string[];
  suggestions?: string[];
  reason?: string;
}

/**
 * Build a structured "couldn't fetch — try next" response. The text format
 * is deliberately friendly to LLM parsing: clear sections, bullet lists,
 * and a single action verb per suggestion.
 */
export function buildFallbackResponse(ctx: FallbackContext): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.displayName}`);
  lines.push("");
  lines.push(
    `> Status: Documentation could not be retrieved.${ctx.reason ? ` (${ctx.reason})` : ""}`,
  );
  lines.push("");

  if (ctx.attemptedSources && ctx.attemptedSources.length > 0) {
    lines.push("## Sources attempted");
    for (const url of ctx.attemptedSources) {
      lines.push(`- ${url}`);
    }
    lines.push("");
  }

  lines.push("## What to do next");
  const suggestions = ctx.suggestions ?? defaultSuggestions();
  for (const s of suggestions) {
    lines.push(`- ${s}`);
  }
  lines.push("");
  lines.push("This response is never empty — even when the primary sources fail, the next step is always actionable.");

  return withNotice(lines.join("\n"));
}

function defaultSuggestions(): string[] {
  return [
    "Call `gt_resolve_library({ libraryName })` to verify the library ID",
    "Call `gt_search({ query })` for a freeform topic lookup that does not require a registry entry",
    "Provide a direct docs URL as the `libraryId` (e.g. `https://docs.example.com`)",
    "Drop the `topic` filter and try again to get the broader main docs page",
  ];
}

/**
 * Sanity-check a candidate response. If it's empty, too short, or marked
 * as a fetch failure, fall through to a guaranteed fallback response.
 */
export function guaranteeText(
  candidate: string | undefined | null,
  fallback: FallbackContext,
  minLength = 80,
): string {
  if (typeof candidate === "string" && candidate.trim().length >= minLength) {
    return candidate;
  }
  return buildFallbackResponse(fallback);
}
