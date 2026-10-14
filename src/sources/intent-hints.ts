/**
 * Lexical tables the intent router matches against. Data, not logic — exempt
 * from the 200-line source convention.
 */
import type { GtToolName } from "../services/intent/types.js";

/** Words/phrases that always strip from the query before further matching */
// Word edges that also treat "-" as part of the word, so noise never cuts a
// hyphenated package name apart ("browser-use", "react-use", "npm-run-all").
export const NOISE_PHRASES = [
  // "use" is noise ("use gt for react") EXCEPT in "can i use X" — that is the
  // caniuse compat idiom and must survive to hint matching.
  /(?<!\bcan\s+i\s)(?<![\w-])use(?![\w-])/gi,
  /(?<![\w-])(?:using|run|invoke|call|please|can\s+you|could\s+you|let'?s|i\s+want\s+to|i\s+need|just|simply|quickly|tolong|mohon|bisa|coba|apakah|bagaimana|gunakan|pakai)(?![\w-])/gi,
  /(?<![\w-])(?:gt(?:\s*[-_]?\s*mcp)?|groundtruth(?:\s*mcp)?|the\s+gt|the\s+gt[-_]?mcp)(?![\w-])/gi,
  /(?<![\w-])please(?![\w-])/gi,
];

/** Single-word tokens that strongly signal a tool, sorted by precision */
// Matched whole-word, so inflected forms are listed explicitly. "migrations" is
// left out on purpose: "drizzle migrations" is a docs question, not an upgrade.
export const VERB_HINTS: Array<{ tool: GtToolName; words: string[] }> = [
  { tool: "gt_audit", words: ["audit", "audits", "auditing", "find issues", "find bugs", "check issues", "find problems", "code issues", "review code", "scan code", "scan source", "find all the issues", "find all issues", "find all bugs", "any issues", "any bugs", "periksa kode", "audit kode", "cari bug", "cek masalah", "periksa masalah", "cek isu"] },
  { tool: "gt_migration", words: ["migrate", "migration", "upgrade", "upgrades", "upgrading", "breaking change", "breaking changes", "move from", "switch to", "migrasi", "cara migrasi", "panduan migrasi", "cara upgrade"] },
  { tool: "gt_changelog", words: ["changelog", "changelogs", "release notes", "what's new", "whats new", "new in", "recent changes", "catatan rilis", "apa yang baru", "perubahan terbaru"] },
  { tool: "gt_compare", words: ["compare", "vs", "versus", "differences between", "which one", "or better", "bandingkan", "perbandingan", "beda antara", "pilih mana", "lebih bagus mana"] },
  { tool: "gt_compat", words: ["browser support", "browser compatibility", "compatibility", "supported in", "works on", "caniuse", "can i use", "does safari", "does chrome", "does firefox", "does edge", "does node", "safari support", "chrome support", "firefox support", "edge support", "node support", "which browsers", "baseline status", "kompatibilitas", "apakah didukung", "dukungan browser"] },
  { tool: "gt_examples", words: ["example", "examples", "real-world", "real world", "show me code", "sample", "samples", "contoh kode", "contoh penggunaan", "sampel kode"] },
  { tool: "gt_snippets", words: ["snippets", "snippet", "code snippets", "snippet index", "cuplikan kode"] },
  { tool: "gt_best_practices", words: ["best practices", "best-practices", "patterns", "recommendations", "guidelines", "tips for", "praktik terbaik", "rekomendasi", "best practice", "pola terbaik"] },
  { tool: "gt_auto_scan", words: ["scan project", "scan dependencies", "scan deps", "all my deps", "all dependencies", "every dependency", "every library", "pindai proyek", "pindai dependensi", "scan proyek"] },
  { tool: "gt_batch_resolve", words: ["resolve multiple", "lookup all", "batch lookup", "resolve every"] },
  { tool: "gt_search", words: ["search for", "find docs about", "look up topic", "what is", "explain", "cari tentang", "jelaskan", "apa itu"] },
  { tool: "gt_get_docs", words: ["docs for", "documentation for", "official docs", "fetch docs", "read docs", "dokumentasi", "baca dokumentasi", "buka dokumentasi"] },
  { tool: "gt_resolve_library", words: ["resolve", "lookup", "look up", "find library", "where is", "cari library", "cari pustaka", "temukan library"] },
];

export const URL_RE = /\bhttps?:\/\/\S+/i;

/**
 * Ordinary English and generic developer vocabulary, including technology
 * words that work as common nouns ("a docker image", "jwt tokens"). A library
 * alias made only of these words ("click", "rich", "next", "browser use") is
 * ambiguous in free text, so detection accepts it only with corroborating
 * context (see services/intent/corroborate.ts). Membership never blocks an
 * alias: "python click", "docs for spring", "`rich`" and "Click" still resolve.
 * Add a word here when it is ordinary vocabulary, not because a library is
 * named after it.
 */
export const GENERIC_WORDS = new Set([
  // question / filler words
  "docs", "documentation", "about", "with", "from", "that", "this", "there",
  "what", "when", "where", "which", "while", "would", "should", "could",
  "have", "help", "does", "into", "your", "some", "more", "most", "best",
  "make", "made", "want", "need", "show", "tell", "give", "find", "look",
  "work", "works", "working", "using", "used", "same", "than", "then", "them",
  "go", "next", "new", "old", "first", "last", "real", "fake", "true", "anyhow",
  "together", "replicate", "conform", "outlines", "instructor", "haystack",
  // generic development nouns and verbs
  "build", "builds", "building", "builder", "builders", "test", "tests", "testing",
  "unit", "code", "codes", "data", "file", "files", "page", "pages", "site", "sites",
  "view", "views", "type", "types", "name", "names", "list", "lists", "item", "items",
  "value", "values", "state", "event", "events", "form", "forms", "input", "button",
  "color", "theme", "mode", "user", "users", "login", "email", "text", "size", "time",
  "date", "error", "errors", "screen", "image", "images", "video", "audio", "font",
  "fonts", "camera", "vision", "location", "network", "device", "speech", "symbols",
  "widget", "widgets", "table", "tables", "chart", "charts", "server", "client",
  "style", "styles", "layout", "route", "routes", "router", "routing", "config",
  "setup", "install", "update", "delete", "create", "write", "read", "async", "await",
  "class", "validator", "function", "functions", "method", "object", "array", "string",
  "number", "boolean", "component", "components", "props", "hook", "hooks", "rest",
  "http", "https", "json", "yaml", "html", "call", "calls", "handle", "handler",
  "parse", "parser", "fetch", "load", "loading", "upload", "download", "draw", "plot",
  "train", "collect", "format", "formatting", "click", "tap", "drag", "drop",
  "dropzone", "scroll", "render", "deploy", "deployment", "serve", "serving", "run",
  "send", "store", "cache", "caching", "search", "query", "queries", "map", "maps",
  "mock", "mocking", "log", "logging", "logs", "trace", "tracing", "observability",
  "monitoring", "metrics", "analytics", "schedule", "scheduler", "cron", "jobs",
  "job", "task", "tasks", "queue", "queues", "worker", "workers", "thread", "threads",
  "process", "processing", "pipeline", "pipelines", "workflow", "workflows",
  "rules", "rule", "policy", "model", "models", "agent", "agents", "vector",
  "embedded", "database", "storage", "container", "containers", "cluster", "node",
  "edge", "graph", "tree", "grid", "machine", "engine", "framework", "library",
  "package", "module", "plugin", "middleware", "source", "console", "terminal",
  "command", "commands", "option", "options", "variables", "environment", "secrets",
  "headers", "header", "request", "requests", "response", "session", "sessions",
  "token", "tokens", "message", "messages", "signal", "signals", "socket",
  "realtime", "access", "management", "security", "secure", "performance",
  "optimization", "accessibility", "notifications", "authentication", "progress",
  "virtual", "static", "headless", "rich", "plain", "base", "open", "solid",
  "sharp", "elastic", "temporal", "fly", "railway", "warp", "rocket", "tower",
  "echo", "chi", "fiber", "three", "alpine", "nest", "unified", "payload", "motion",
  "effect", "effects", "spring", "physics", "transition", "transitions", "ray",
  "marked", "bootstrap", "inertia", "hypothesis", "coverage", "transformers",
  "vault", "bandit", "black", "chroma", "fuse", "underscore", "qrcode", "pkg",
  "modal", "dialog", "tooltip", "picker", "dropdown", "editor", "clipboard",
  "carousel", "accordion", "boundary", "circuit", "actions", "action", "design",
  "icons", "ui", "ux", "sitemap", "seo", "webview", "worklets", "generator", "browser", "web",
  "agent-to-agent", "protocol", "parameter", "efficient", "fine", "tuning",
  "ratelimit", "rate", "limit", "schema", "schemas", "lazy", "service", "services",
  "serialization", "css", "modules", "plugins", "h1", "h2", "h3", "h4", "h5", "h6", "tsx", "jsx",
  // web-platform standards and infrastructure used as common nouns; gt_search
  // carries curated topic pages for these
  "ai", "cc", "mcp", "ts", "py", "pg", "wp", "tf", "ws", "amqp", "openapi",
  "swagger", "graphql", "grpc", "protobuf", "docker", "dockerfile", "kubernetes",
  "k8s", "terraform", "serverless", "websocket", "websockets", "webworkers",
  "serviceworker", "webrtc", "indexeddb", "flexbox", "webcrypto", "etag", "cors",
  "csp", "sqli", "xss", "hsts", "oauth", "jwt", "oidc", "openid", "sso", "saml",
  "webauthn", "passkey", "passkeys", "wcag", "aria", "cwv", "lcp", "inp", "cls",
  "webp", "avif", "owasp", "a11y", "i18n",
]);

/** Closed-class words that carry no subject: dropped from topics and corroboration. */
export const FUNCTION_WORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "by", "for", "with", "from",
  "into", "onto", "about", "over", "as", "is", "are", "was", "were", "be", "been",
  "do", "does", "did", "have", "has", "had", "i", "me", "my", "we", "our", "us",
  "you", "your", "it", "its", "this", "that", "these", "those", "there", "here",
  "what", "which", "who", "when", "where", "why", "how", "can", "could", "should",
  "would", "will", "may", "might", "must", "and", "or", "but", "if", "so", "than",
  "too", "very", "just", "also", "only", "some", "any", "all", "each", "every",
  "get", "way", "ways", "via", "use", "using", "properly", "show", "tell", "give",
  "help", "want", "need",
]);

/** Words that mark a token as a library/tool name when they sit next to it. */
export const LIBRARY_ANCHORS = new Set([
  "library", "lib", "package", "pkg", "sdk", "crate", "gem", "framework", "cli",
]);

/**
 * Words that ask ABOUT a library rather than describe a task. A query made only
 * of an ambiguous alias plus these ("what's new in next", "docs for spring") is
 * a library request.
 */
export const INTENT_WORDS = new Set([
  "docs", "doc", "documentation", "reference", "api", "changelog", "changes",
  "release", "releases", "notes", "new", "what's", "whats", "latest", "version",
  "versions", "upgrade", "upgrading", "migrate", "migration", "guide", "guides",
  "tutorial", "example", "examples", "sample", "samples", "snippet", "snippets",
  "best", "practices", "patterns", "tips", "install", "installation", "usage",
  "overview", "readme", "lookup", "resolve", "compare", "vs", "versus",
  ...LIBRARY_ANCHORS,
]);

/** Language / ecosystem words, grouped with the registry `language` values they imply. */
const ECOSYSTEMS: Array<[words: string[], languages: string[]]> = [
  [["python", "py", "python3", "pip", "pip3", "pypi", "conda"], ["python"]],
  [["javascript", "js", "typescript", "ts", "node", "nodejs", "node.js", "npm", "pnpm", "yarn", "deno", "bun"],
    ["javascript", "typescript"]],
  [["rust", "rustlang", "cargo", "crate", "crates"], ["rust"]],
  [["go", "golang"], ["go"]],
  [["java", "jvm", "kotlin", "scala", "maven", "gradle"], ["java", "kotlin", "scala"]],
  [["c#", "csharp", ".net", "dotnet", "nuget"], ["csharp"]],
  [["ruby", "gem", "gems", "rubygems"], ["ruby"]],
  [["php", "packagist"], ["php"]],
  [["swift", "ios", "xcode", "swiftpm"], ["swift"]],
  [["dart", "flutter"], ["dart"]],
  [["elixir", "erlang"], ["elixir"]],
  [["c++", "cpp", "cmake"], ["cpp", "c++", "c"]],
];

export const ECOSYSTEM_WORDS: ReadonlyMap<string, readonly string[]> = new Map(
  ECOSYSTEMS.flatMap(([words, languages]) => words.map((w): [string, string[]] => [w, languages])),
);
