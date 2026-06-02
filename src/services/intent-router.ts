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
import { lookupByAlias, fuzzySearch } from "../sources/registry.js";

export type GtToolName =
  | "gt_resolve_library"
  | "gt_get_docs"
  | "gt_best_practices"
  | "gt_auto_scan"
  | "gt_search"
  | "gt_audit"
  | "gt_changelog"
  | "gt_compat"
  | "gt_compare"
  | "gt_examples"
  | "gt_migration"
  | "gt_batch_resolve"
  | "gt_snippets";

export interface IntentMatch {
  tool: GtToolName;
  args: Record<string, unknown>;
  reason: string;
  /** 0.0–1.0 confidence score */
  confidence: number;
}

/** Words/phrases that always strip from the query before further matching */
const NOISE_PHRASES = [
  /\b(?:use|using|run|invoke|call|please|can\s+you|could\s+you|let'?s|i\s+want\s+to|i\s+need|just|simply|quickly)\b/gi,
  /\b(?:gt(?:\s*[-_]?\s*mcp)?|groundtruth(?:\s*mcp)?|the\s+gt|the\s+gt[-_]?mcp)\b/gi,
  /\bplease\b/gi,
];

function stripNoise(query: string): string {
  let s = query.toLowerCase().trim();
  for (const re of NOISE_PHRASES) {
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Single-word tokens that strongly signal a tool, sorted by precision */
const VERB_HINTS: Array<{ tool: GtToolName; words: string[] }> = [
  { tool: "gt_audit", words: ["audit", "find issues", "find bugs", "check issues", "find problems", "code issues", "review code", "scan code", "scan source", "find all the issues", "find all issues", "find all bugs", "any issues", "any bugs"] },
  { tool: "gt_migration", words: ["migrate", "migration", "upgrade", "upgrading", "breaking change", "breaking changes", "move from", "switch to"] },
  { tool: "gt_changelog", words: ["changelog", "release notes", "what's new", "whats new", "new in", "recent changes"] },
  { tool: "gt_compare", words: ["compare", "vs", "versus", "differences between", "which one", "or better"] },
  { tool: "gt_compat", words: ["browser support", "browser compatibility", "compatibility", "supported in", "works on", "caniuse"] },
  { tool: "gt_examples", words: ["example", "examples", "real-world", "real world", "show me code", "sample"] },
  { tool: "gt_snippets", words: ["snippets", "snippet", "code snippets", "snippet index"] },
  { tool: "gt_best_practices", words: ["best practices", "best-practices", "patterns", "recommendations", "guidelines", "tips for"] },
  { tool: "gt_auto_scan", words: ["scan project", "scan dependencies", "scan deps", "all my deps", "all dependencies", "every dependency", "every library"] },
  { tool: "gt_batch_resolve", words: ["resolve multiple", "lookup all", "batch lookup", "resolve every"] },
  { tool: "gt_search", words: ["search for", "find docs about", "look up topic", "what is", "explain"] },
  { tool: "gt_get_docs", words: ["docs for", "documentation for", "official docs", "fetch docs", "read docs"] },
  { tool: "gt_resolve_library", words: ["resolve", "lookup", "look up", "find library", "where is"] },
];

const URL_RE = /\bhttps?:\/\/\S+/i;

/**
 * Detects a library mention by scanning each token against the registry alias
 * table. Returns the longest matching alias, since users say "next.js" not "next".
 */
function detectLibrary(text: string): { id: string; name: string; alias: string } | null {
  // Multi-word aliases first (e.g. "react native", "next.js", "tailwind css")
  const phrases = [
    /\bnext\.?js\b/i,
    /\bnuxt\.?js?\b/i,
    /\breact\s+native\b/i,
    /\bnode\.?js\b/i,
    /\bvue\.?js?\b/i,
    /\btailwind\s+css\b/i,
    /\bspring\s+boot\b/i,
    /\bclaude\s+code\b/i,
    /\bclaude\s+agent\s+sdk\b/i,
  ];
  for (const re of phrases) {
    const m = text.match(re);
    if (m) {
      const alias = m[0].toLowerCase().replace(/\s+/g, " ");
      const entry = lookupByAlias(alias);
      if (entry) return { id: entry.id, name: entry.name, alias };
    }
  }

  // Single-word alias lookup against the registry
  const tokens = text.split(/[\s,]+/).filter((t) => t.length >= 2 && t.length <= 60);
  for (const tok of tokens) {
    const cleaned = tok.replace(/[^\w@/.-]/g, "");
    if (!cleaned) continue;
    const entry = lookupByAlias(cleaned);
    if (entry) return { id: entry.id, name: entry.name, alias: cleaned };
  }

  // Fuzzy fallback on the longest non-stop word
  const longest = tokens
    .filter((t) => t.length >= 3 && !["docs", "the", "for", "and", "from", "with"].includes(t))
    .sort((a, b) => b.length - a.length)[0];
  if (longest) {
    // minScore 20 = at least an alias-contains match; rejects tag-only (10) and
    // npm-package-contains-only (15) hits that otherwise misroute generic queries
    // ("how to build a rest api" -> a build-tool library).
    const matches = fuzzySearch(longest, 1, 20);
    if (matches[0]) return { id: matches[0].id, name: matches[0].name, alias: longest };
  }

  return null;
}

/** True if the query looks like a project-level "use gt" call (no library) */
function isProjectLevelInvocation(query: string): boolean {
  const cleaned = stripNoise(query);
  if (cleaned.length === 0) return true;
  return /\b(?:project|here|this|my\s+code|repo|repository|codebase|app|deps?|dependencies|files?)\b/.test(cleaned);
}

/** Detect the user wants migration: from→to version mentioned */
function extractMigrationVersions(text: string): { from?: string; to?: string } {
  const m = text.match(/\bfrom\s+(?:v?)(\d+(?:\.\d+)*)\s+to\s+(?:v?)(\d+(?:\.\d+)*)/i);
  if (m && m[1] && m[2]) return { from: m[1], to: m[2] };
  const v = text.match(/\bv?(\d+(?:\.\d+)*)\s*(?:→|->|to)\s*v?(\d+(?:\.\d+)*)/);
  if (v && v[1] && v[2]) return { from: v[1], to: v[2] };
  return {};
}

/** Extract a topic phrase after "about", "for", "on" */
function extractTopic(text: string): string | undefined {
  // Prefer the more specific "about ..." marker — it scopes the topic
  // tightly. Fall back to "regarding", then quoted strings, then "for/on".
  const tries = [
    /\babout\s+([\w./@-]+(?:\s+[\w./@-]+){0,4})/i,
    /\bregarding\s+([\w./@-]+(?:\s+[\w./@-]+){0,4})/i,
    /['"]([^'"]{3,60})['"]/,
    /\b(?:for|on|re:?)\s+([\w\s./@-]{3,60})/i,
  ];
  for (const re of tries) {
    const m = text.match(re);
    if (m && m[1]) {
      const t = m[1].trim();
      if (t.length >= 2) return t;
    }
  }
  return undefined;
}

export interface IntentInput {
  query: string;
  projectPath?: string;
}

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

  // 2. Verb hints — scan ordered list, longest-first match wins
  const verbHits: Array<{ tool: GtToolName; word: string }> = [];
  for (const { tool, words } of VERB_HINTS) {
    for (const w of words) {
      if (text.includes(w)) {
        verbHits.push({ tool, word: w });
      }
    }
  }
  verbHits.sort((a, b) => b.word.length - a.word.length);

  const library = detectLibrary(text);
  const topic = extractTopic(text);

  // 3. Resolve from verb hits
  if (verbHits[0]) {
    const top = verbHits[0];
    const args: Record<string, unknown> = {};

    switch (top.tool) {
      case "gt_audit": {
        args["projectPath"] = projectPath ?? ".";
        args["categories"] = ["all"];
        return {
          tool: "gt_audit",
          args,
          reason: `detected audit/scan verb ("${top.word}")`,
          confidence: 0.9,
        };
      }
      case "gt_migration": {
        if (library) args["libraryId"] = library.id;
        const versions = extractMigrationVersions(raw);
        if (versions.from !== undefined) args["fromVersion"] = versions.from;
        if (versions.to !== undefined) args["toVersion"] = versions.to;
        return {
          tool: "gt_migration",
          args,
          reason: `detected migration verb ("${top.word}")` + (library ? ` for ${library.name}` : ""),
          confidence: library ? 0.92 : 0.7,
        };
      }
      case "gt_changelog": {
        if (library) args["libraryId"] = library.id;
        return {
          tool: "gt_changelog",
          args,
          reason: `detected changelog/release verb ("${top.word}")` + (library ? ` for ${library.name}` : ""),
          confidence: library ? 0.92 : 0.6,
        };
      }
      case "gt_compare": {
        const libs: string[] = [];
        // crude: look for "X vs Y" or "X or Y" or "X, Y"
        const vs = raw.match(/([\w@/.-]+)\s+(?:vs\.?|versus|or)\s+([\w@/.-]+)/i);
        if (vs && vs[1] && vs[2]) libs.push(vs[1], vs[2]);
        if (libs.length >= 2) args["libraries"] = libs;
        return {
          tool: "gt_compare",
          args,
          reason: `detected compare verb ("${top.word}")`,
          confidence: libs.length >= 2 ? 0.92 : 0.6,
        };
      }
      case "gt_compat": {
        if (topic) args["feature"] = topic;
        else if (text) args["feature"] = text.replace(/\b(?:browser|support|compatibility|in|on)\b/g, "").trim();
        return {
          tool: "gt_compat",
          args,
          reason: `detected compatibility verb ("${top.word}")`,
          confidence: 0.85,
        };
      }
      case "gt_examples": {
        if (library) args["library"] = library.alias;
        if (topic) args["pattern"] = topic;
        return {
          tool: "gt_examples",
          args,
          reason: `detected example verb ("${top.word}")` + (library ? ` for ${library.name}` : ""),
          confidence: library ? 0.9 : 0.65,
        };
      }
      case "gt_best_practices": {
        if (library) args["libraryId"] = library.id;
        if (topic) args["topic"] = topic;
        return {
          tool: "gt_best_practices",
          args,
          reason: `detected best-practices verb` + (library ? ` for ${library.name}` : ""),
          confidence: library ? 0.93 : 0.7,
        };
      }
      case "gt_auto_scan": {
        args["projectPath"] = projectPath ?? ".";
        return {
          tool: "gt_auto_scan",
          args,
          reason: `detected project-scan intent ("${top.word}")`,
          confidence: 0.92,
        };
      }
      case "gt_get_docs": {
        if (library) args["libraryId"] = library.id;
        if (topic) args["topic"] = topic;
        return {
          tool: "gt_get_docs",
          args,
          reason: `detected docs verb` + (library ? ` for ${library.name}` : ""),
          confidence: library ? 0.95 : 0.6,
        };
      }
      case "gt_resolve_library": {
        if (library) args["libraryName"] = library.alias;
        else args["libraryName"] = text.split(/\s+/)[0] ?? "";
        return {
          tool: "gt_resolve_library",
          args,
          reason: "detected lookup intent",
          confidence: 0.8,
        };
      }
      case "gt_batch_resolve": {
        // text still contains verb tokens ("batch","lookup") but lookupByAlias
        // filters them out since they are not registry aliases — batchTokens
        // ends up holding only genuine library names.
        const batchTokens = text
          .split(/[\s,]+/)
          .map((t) => t.replace(/[^\w@/.-]/g, ""))
          .filter((t) => t.length >= 2 && t.length <= 60 && !!lookupByAlias(t));
        if (batchTokens.length > 0) {
          args["libraryNames"] = batchTokens;
          return {
            tool: "gt_batch_resolve",
            args,
            reason: `detected batch-resolve verb ("${top.word}") with ${batchTokens.length} library name(s)`,
            confidence: 0.82,
          };
        }
        // No parseable library names — gt_batch_resolve requires a non-empty
        // libraryNames array (Zod .min(1)), so fall back to freeform search
        // instead of emitting args that would fail validation.
        return {
          tool: "gt_search",
          args: { query: raw },
          reason: `batch-resolve verb detected but no library names parseable — fallback to search`,
          confidence: 0.5,
        };
      }
      case "gt_search":
      case "gt_snippets":
      default: {
        if (top.tool === "gt_search") args["query"] = topic ?? text;
        if (top.tool === "gt_snippets" && library) args["libraryId"] = library.id;
        return {
          tool: top.tool,
          args,
          reason: `detected verb ("${top.word}")`,
          confidence: 0.75,
        };
      }
    }
  }

  // 4. No verb hit — but library mentioned → best practices is the safest default
  if (library) {
    return {
      tool: "gt_best_practices",
      args: { libraryId: library.id, ...(topic !== undefined ? { topic } : {}) },
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
