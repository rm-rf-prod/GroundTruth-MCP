/**
 * Server instructions string rendered into the MCP server.instructions field.
 * Extracted from index.ts (MX-004) so it can be unit-tested and edited in
 * isolation. toolCount is passed in so the tool count stays the single source
 * of truth in constants.ts (TOOL_COUNT).
 */
export function buildServerInstructions(toolCount: number): string {
  return `GroundTruth: live documentation and best-practices MCP server.

Covers libraries, frameworks, web standards (MDN), security (OWASP), accessibility (WCAG), performance, HTTP, CSS, auth standards, databases, infrastructure. Content is fetched at request time from official sources, not from training data.

# Tools (${toolCount})

1. **gt_dispatch**. Routes a plain-text query ("use gt mcp", "find issues", "best practices for next.js") to the correct gt_* tool with the right args. Call it whenever the user's intent is ambiguous, or they say "use gt" without specifying a tool.
2. **gt_resolve_library**. Resolves a library or framework name to its canonical ID and docs URL. Call before gt_get_docs unless you already have the ID.
3. **gt_get_docs**. Fetches current documentation for one library. Optional topic filter and lockfile-based version pinning.
4. **gt_best_practices**. Returns current best practices for a single library, scoped by topic and version.
5. **gt_auto_scan**. Detects every dependency in a project and fetches best practices for each in one call.
6. **gt_search**. Freeform topic search. Works for any subject (web standards, security, accessibility), no library name required.
7. **gt_audit**. Scans project source code for issues across 18 categories (security, performance, accessibility, etc.) and returns fixes sourced from official docs.
8. **gt_changelog**. Recent release notes. Read before upgrading a library.
9. **gt_compat**. Browser and runtime compatibility data from MDN and caniuse.
10. **gt_compare**. Side-by-side comparison of two or three libraries.
11. **gt_examples**. GitHub usage examples for a library, optionally filtered by pattern.
12. **gt_migration**. Migration guides, breaking changes, and upgrade steps between versions.
13. **gt_batch_resolve**. Resolves up to 20 library names in one call.
14. **gt_snippets**. Pre-indexed, ranked code snippets per library and version. Context7-compatible output shape with persistent disk cache.

# Trigger phrase routing

If the user types any of the following, call the listed tool. No clarification needed first.

| User says... | Call this... |
|---|---|
| "use gt" / "use gt mcp" / "groundtruth this" (no library) | \`gt_auto_scan({ projectPath: "." })\` |
| "use gt for X" / "use gt mcp for X" / "check docs for X" | \`gt_resolve_library({ libraryName: "X" })\`, then \`gt_best_practices({ libraryId })\` |
| "best practices for X" / "patterns for X" / "X tips" | \`gt_best_practices({ libraryId: "X" })\` |
| "docs for X" / "documentation for X" / "X docs about Y" | \`gt_get_docs({ libraryId: "X", topic: "Y" })\` |
| "scan project" / "scan dependencies" / "all my deps" | \`gt_auto_scan({ projectPath: "." })\` |
| "audit" / "find issues" / "find bugs" / "review code" | \`gt_audit({ categories: ["all"] })\` |
| "changelog X" / "what's new in X" / "release notes for X" | \`gt_changelog({ libraryId: "X" })\` |
| "migrate X from N to M" / "upgrade X to M" | \`gt_migration({ libraryId: "X", fromVersion, toVersion })\` |
| "browser support for Y" / "compatibility of Y" | \`gt_compat({ feature: "Y" })\` |
| "compare X vs Y" / "X or Y" | \`gt_compare({ libraries: ["X", "Y"] })\` |
| "examples of X" / "how do I X with Y" | \`gt_examples({ library: "X", pattern: "Y" })\` |
| "snippets for X" / "X snippets" | \`gt_snippets({ libraryId: "X" })\` |
| Anything else / unclear intent | \`gt_dispatch({ query: "<the raw user text>" })\` |
| URL pasted | \`gt_get_docs({ libraryId: "<url>" })\` |

# When to use gt_dispatch

Call \`gt_dispatch\` when you are uncertain which tool fits. It returns a routing decision (tool, args, confidence) so you can immediately make the next call. It always returns something usable, accepts any natural-language input, and adds under 100ms of overhead.

# Reliability

Every tool returns an actionable response, even on fetch failure (next-step suggestions). Input is validated with zod, so invalid input rejects with a clear error. The fetcher tries llms.txt, then Jina Reader, then direct HTML, then GitHub README, then npm or PyPI. Per-domain circuit breakers skip failing domains after 3 failures and retry after 60 seconds. In-flight requests are deduplicated, so concurrent identical fetches share one network call. The cache has two tiers: LRU memory and SHA-256 disk, with stale-while-revalidate. Responses are watermarked and carry a license notice.

# Anti-patterns

- Do not ask the user "which library?" if their message names one. \`gt_resolve_library\` does the matching.
- Do not call \`gt_get_docs\` before \`gt_resolve_library\` unless you already have a verified library ID or URL.
- Do not loop \`gt_search\` when \`gt_best_practices\` would work. Search is the catch-all, not the default.
- Do not scrape the registry. Only look up specific libraries by name. Elastic License 2.0.`;
}
