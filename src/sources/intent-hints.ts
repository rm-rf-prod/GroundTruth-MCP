/**
 * Lexical tables the intent router matches against. Data, not logic — exempt
 * from the 200-line source convention.
 */
import type { GtToolName } from "../services/intent/types.js";

/** Words/phrases that always strip from the query before further matching */
export const NOISE_PHRASES = [
  // "use" is noise ("use gt for react") EXCEPT in "can i use X" — that is the
  // caniuse compat idiom and must survive to hint matching.
  /(?<!\bcan\s+i\s)\buse\b/gi,
  /\b(?:using|run|invoke|call|please|can\s+you|could\s+you|let'?s|i\s+want\s+to|i\s+need|just|simply|quickly)\b/gi,
  /\b(?:gt(?:\s*[-_]?\s*mcp)?|groundtruth(?:\s*mcp)?|the\s+gt|the\s+gt[-_]?mcp)\b/gi,
  /\bplease\b/gi,
];

/** Single-word tokens that strongly signal a tool, sorted by precision */
export const VERB_HINTS: Array<{ tool: GtToolName; words: string[] }> = [
  { tool: "gt_audit", words: ["audit", "find issues", "find bugs", "check issues", "find problems", "code issues", "review code", "scan code", "scan source", "find all the issues", "find all issues", "find all bugs", "any issues", "any bugs"] },
  { tool: "gt_migration", words: ["migrate", "migration", "upgrade", "upgrading", "breaking change", "breaking changes", "move from", "switch to"] },
  { tool: "gt_changelog", words: ["changelog", "release notes", "what's new", "whats new", "new in", "recent changes"] },
  { tool: "gt_compare", words: ["compare", "vs", "versus", "differences between", "which one", "or better"] },
  { tool: "gt_compat", words: ["browser support", "browser compatibility", "compatibility", "supported in", "works on", "caniuse", "can i use", "does safari", "does chrome", "does firefox", "does edge", "does node", "safari support", "chrome support", "firefox support", "edge support", "node support", "which browsers", "baseline status"] },
  { tool: "gt_examples", words: ["example", "examples", "real-world", "real world", "show me code", "sample"] },
  { tool: "gt_snippets", words: ["snippets", "snippet", "code snippets", "snippet index"] },
  { tool: "gt_best_practices", words: ["best practices", "best-practices", "patterns", "recommendations", "guidelines", "tips for"] },
  { tool: "gt_auto_scan", words: ["scan project", "scan dependencies", "scan deps", "all my deps", "all dependencies", "every dependency", "every library"] },
  { tool: "gt_batch_resolve", words: ["resolve multiple", "lookup all", "batch lookup", "resolve every"] },
  { tool: "gt_search", words: ["search for", "find docs about", "look up topic", "what is", "explain"] },
  { tool: "gt_get_docs", words: ["docs for", "documentation for", "official docs", "fetch docs", "read docs"] },
  { tool: "gt_resolve_library", words: ["resolve", "lookup", "look up", "find library", "where is"] },
];

export const URL_RE = /\bhttps?:\/\/\S+/i;

/**
 * Ordinary English and generic-programming words that must never trigger the
 * fuzzy registry fallback. The registry contains libraries literally named
 * after these words ("expo-build-properties", "expo-image", "expo-camera"),
 * so a bare "how to build a rest api" would otherwise fuzzy-match a library
 * and route to gt_best_practices instead of gt_search.
 *
 * Only the FUZZY fallback consults this list — an exact alias hit
 * ("expo-camera", "next.js") still resolves normally one step earlier.
 */
export const FUZZY_STOP_WORDS = new Set([
  // question / filler words
  "docs", "documentation", "about", "with", "from", "that", "this", "there",
  "what", "when", "where", "which", "while", "would", "should", "could",
  "have", "help", "does", "into", "your", "some", "more", "most", "best",
  "make", "made", "want", "need", "show", "tell", "give", "find", "look",
  "work", "works", "working", "using", "used", "same", "than", "then", "them",
  // generic development nouns that double as library names
  "build", "builds", "building", "test", "tests", "testing", "code", "codes",
  "data", "file", "files", "page", "pages", "site", "sites", "view", "views",
  "type", "types", "name", "names", "list", "item", "items", "value", "values",
  "state", "event", "events", "form", "forms", "input", "button", "color",
  "theme", "mode", "user", "users", "login", "email", "text", "size", "time",
  "date", "error", "errors", "screen", "image", "images", "video", "audio",
  "font", "fonts", "camera", "location", "network", "device", "speech",
  "symbols", "widget", "widgets", "table", "tables", "chart", "charts",
  "server", "client", "style", "styles", "layout", "route", "routes",
  "config", "setup", "install", "update", "delete", "create", "write", "read",
  "async", "await", "class", "function", "method", "object", "array", "string",
  "number", "boolean", "component", "components", "props", "hook", "hooks",
  "rest", "http", "https", "json", "yaml", "html", "call", "calls",
]);
