/**
 * Build a human-readable routing table — embedded into server.instructions
 * so the LLM client can see the deterministic routing rules and pick the
 * right tool without relying on the dispatch tool.
 */
export function renderRoutingTable(): string {
  return [
    "## Trigger phrase routing",
    "",
    "| User input pattern | Tool to call | Notes |",
    "|---|---|---|",
    "| `use gt` / `use gt mcp` (no library named) | `gt_auto_scan({projectPath:'.'})` | Scans every dep in the project for current best practices |",
    "| `use gt for X` / `check docs for X` / library name | `gt_resolve_library({libraryName:'X'})` then `gt_best_practices({libraryId})` | Looks up X then fetches its current best practices |",
    "| `find issues` / `audit` / `scan code` | `gt_audit({categories:['all']})` | Code-level issue scan with live fix guidance |",
    "| `what's new in X` / `release notes for X` / `changelog X` | `gt_changelog({libraryId:'X'})` | Recent releases + release notes |",
    "| `migrate X from 14 to 15` / `upgrade X` | `gt_migration({libraryId:'X', fromVersion, toVersion})` | Breaking changes + upgrade steps |",
    "| `compare X vs Y` / `X or Y` | `gt_compare({libraries:['X','Y']})` | Side-by-side comparison |",
    "| `browser support for Z` / `compatibility of Z` | `gt_compat({feature:'Z'})` | MDN + caniuse merged compat |",
    "| `show me examples of X with Y` | `gt_examples({library:'X', pattern:'Y'})` | Real-world GitHub examples |",
    "| `docs for X about Y` / `how to use X for Y` | `gt_get_docs({libraryId:'X', topic:'Y'})` | Filtered library docs |",
    "| `what is X` / `OWASP SQLi guidance` / topic-only | `gt_search({query:'…'})` | Freeform — any topic, no library required |",
    "| `code snippets for X` / `X snippets` | `gt_snippets({libraryId:'X', topic?})` | Pre-indexed ranked code snippets |",
    "| Pasting a docs URL | `gt_get_docs({libraryId:'<url>'})` | URL works as the libraryId — direct fetch |",
    "",
    "When ambiguous, prefer the smallest-scope tool: a single library → `gt_best_practices`, the whole project → `gt_auto_scan`, no library at all → `gt_search`.",
  ].join("\n");
}
