/**
 * Server instructions string rendered into the MCP server.instructions field.
 * Extracted from index.ts (MX-004) so it can be unit-tested and edited in
 * isolation. toolCount is passed in so the tool count stays the single source
 * of truth in constants.ts (TOOL_COUNT).
 *
 * BUDGET: Claude Code truncates server instructions around 2 KB. The previous
 * version was 5.3 KB, so the routing table — the part that actually changes
 * tool selection — was cut off before the model ever saw it. Everything here
 * earns its bytes: the routing table first, prose only where it prevents a
 * wrong call. Keep the output under INSTRUCTIONS_BYTE_BUDGET; the unit test
 * enforces it.
 */
export const INSTRUCTIONS_BYTE_BUDGET = 2000;

export function buildServerInstructions(toolCount: number): string {
  return `GroundTruth: live docs + best practices, fetched from official sources at request time, never from training data.

Evidence: topic-targeted answers carry an "## Evidence" footer (sources, date, coverage). "No topic-specific evidence found" is a TRUE NEGATIVE — follow its next steps, do not re-call the same tool.

# Tools (${toolCount}) — routing

| User says | Call |
|---|---|
| "use gt", no library named | gt_auto_scan({projectPath:"."}) |
| a library name / "check docs for X" | gt_resolve_library -> gt_best_practices |
| "best practices for X", "X patterns" | gt_best_practices({libraryId,topic?}) |
| "docs for X about Y" | gt_get_docs({libraryId,topic}) |
| "audit", "find issues", "review code" | gt_audit({categories:["all"]}) |
| "what's new in X", "release notes" | gt_changelog({libraryId}) |
| "upgrade/migrate X N to M" | gt_migration({libraryId,fromVersion,toVersion}) |
| "browser support for Y" | gt_compat({feature}) |
| "compare X vs Y" | gt_compare({libraries}) |
| "examples of X" | gt_examples({library,pattern?}) |
| "snippets for X" | gt_snippets({libraryId,topic?}) |
| many names at once | gt_batch_resolve({libraryNames}) |
| any topic, no library | gt_search({query}) |
| a pasted URL | gt_get_docs({libraryId:"<url>"}) |
| unclear intent | gt_dispatch({query:"<raw user text>"}) |

# Rules

- The message names a library: resolve it, never ask which one.
- gt_search is the catch-all, not the default — prefer gt_best_practices for a named library.
- Give topic a real subject ("row level security", not "best practices") — it drives retrieval.
- Registry is Elastic-2.0: look up specific libraries, never enumerate or dump it.`;
}
