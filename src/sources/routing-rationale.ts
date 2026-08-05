import type { GtToolName } from "../services/intent/types.js";

/** Plain-language justification shown for each routing decision. */
export const ROUTING_RATIONALE: Partial<Record<GtToolName, string>> = {
  gt_auto_scan:
    "Your message looks like a project-wide invocation (no specific library named). `gt_auto_scan` walks the dependency manifests in the given project path and fetches the latest best practices for every detected library in one round-trip.",
  gt_best_practices:
    "You named a specific library, so `gt_best_practices` is the lowest-friction tool — it returns current production patterns, performance, security, and testing guidance for that one library.",
  gt_get_docs:
    "You provided either a URL or asked for direct docs. `gt_get_docs` fetches the raw library documentation, optionally filtered by topic. It chains after `gt_resolve_library` if needed.",
  gt_audit:
    "You asked for code-level issues. `gt_audit` scans the project source tree against 18+ issue categories (security, performance, accessibility, etc.) and returns each finding with a live, official-doc-sourced fix.",
  gt_migration:
    "You mentioned an upgrade or migration. `gt_migration` pulls the official migration guide plus breaking-change list for the named library, scoped by version range when supplied.",
  gt_changelog:
    "You asked for what's new / release notes. `gt_changelog` reads GitHub Releases first, then CHANGELOG.md, then the docs site for the most recent entries.",
  gt_compare:
    "Two or more libraries detected. `gt_compare` fetches each one's docs and presents them side-by-side scoped by criteria such as performance, TypeScript support, or bundle size.",
  gt_compat:
    "You're asking about browser / runtime compatibility. `gt_compat` merges MDN and caniuse data for the feature you named.",
  gt_examples:
    "You want real-world code. `gt_examples` searches public GitHub for usage of the library/pattern you named and returns the highest-quality snippets.",
  gt_search:
    "No specific library or scope detected. `gt_search` is the catch-all: any topic, any web standard, any best-practice page.",
  gt_resolve_library:
    "Resolution-only intent detected. `gt_resolve_library` confirms the library exists and returns the canonical ID + docs URL — call `gt_best_practices` or `gt_get_docs` next.",
  gt_snippets:
    "You asked for ranked code snippets. `gt_snippets` builds a Context7-compatible snippet index per library + version with disk caching.",
  gt_batch_resolve:
    "Multi-library lookup detected. `gt_batch_resolve` resolves up to 20 names in a single call.",
};

export const ROUTING_FALLBACK = "Routing fallback — call the recommended tool above.";
