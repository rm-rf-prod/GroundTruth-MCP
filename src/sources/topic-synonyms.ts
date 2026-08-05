/**
 * Vocabulary tables used by tokenization, relevance scoring and the evidence gate.
 * Data, not logic — exempt from the 200-line source convention.
 */

// Common English stop words that add no signal to section relevance scoring
export const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its",
  "may", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "let",
  "man", "put", "say", "she", "too", "use", "from", "that", "this", "they",
  "will", "with", "have", "more", "when", "what", "your", "just", "also",
  "into", "some", "than", "then", "them", "were", "been", "than", "each",
  "which", "their", "there", "would", "about", "these", "other", "after",
  "first", "could", "where", "being", "those", "before", "should",
]);

// Version tokens (15, v16, 3.0) are short but high-signal for migration /
// changelog queries — they must survive tokenization to match version headings.
export const VERSION_TOKEN = /^v?\d+(?:\.\d+)*$/;
// Documentation sites rarely use the same word the caller does: an upgrade
// guide answers a "migration" query, an "optimization" page answers
// "performance". Expansion is used for LINK/URL DISCOVERY only — evidence
// verification stays literal so verdicts never inflate.
export const TOPIC_SYNONYMS: Record<string, readonly string[]> = {
  migration: ["upgrade", "upgrading", "migrate", "migrating"],
  migrate: ["upgrade", "migration", "upgrading"],
  upgrade: ["migration", "upgrading", "migrate"],
  upgrading: ["migration", "upgrade"],
  performance: ["optimization", "optimizing", "optimize", "profiling"],
  optimization: ["performance", "optimizing"],
  auth: ["authentication"],
  authentication: ["auth"],
  caching: ["cache"],
  cache: ["caching"],
  config: ["configuration", "configuring"],
  configuration: ["config"],
  deploy: ["deployment", "deploying"],
  deployment: ["deploy", "deploying"],
  routing: ["router", "routes", "route", "navigation"],
  router: ["routing", "routes"],
  notifications: ["notification", "push"],
  notification: ["notifications"],
  worklets: ["worklet"],
  worklet: ["worklets"],
  testing: ["test", "tests"],
  errors: ["error"],
  error: ["errors"],
  // Acronyms: docs spell these out, callers almost never do.
  jwt: ["json web token"],
  rls: ["row level security", "row-level security"],
  rsc: ["react server component", "server component"],
  ssr: ["server-side rendering", "server side rendering"],
  ssg: ["static site generation", "static generation"],
  isr: ["incremental static regeneration"],
  csp: ["content security policy"],
  cors: ["cross-origin resource sharing"],
  csrf: ["cross-site request forgery"],
  xss: ["cross-site scripting"],
  a11y: ["accessibility"],
  i18n: ["internationalization", "internationalisation", "localization"],
  orm: ["object relational mapper"],
  hmr: ["hot module replacement"],
  ppr: ["partial prerendering"],
  cwv: ["core web vitals", "web vitals"],
  mfa: ["multi-factor authentication", "two-factor"],
  sso: ["single sign-on", "single sign on"],
  rbac: ["role-based access control"],
};
// Query-meta words describe the KIND of answer wanted, not its subject — they
// appear on virtually every docs page, so counting them as topic coverage lets
// entirely off-topic content pass ("Postgres RLS best practices" matching a
// web-perf page on "best practices"). Filtered from evidence/quality scoring;
// kept when they are ALL the caller gave us.
export const META_TOKENS = new Set([
  "best", "practices", "practice", "latest", "guide", "guides", "tips",
  "docs", "documentation", "pattern", "patterns", "overview", "current",
]);
