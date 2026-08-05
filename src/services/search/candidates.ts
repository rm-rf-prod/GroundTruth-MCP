/**
 * Universal direct URL construction — the global fallback that makes ANY topic findable.
 * For any query, we construct URLs on well-known documentation sites using the query as a slug.
 * This ensures we never return "no results" for a topic that has documentation somewhere.
 */
/** Keywords that signal a query maps to a known docs URL path (not a generic phrase) */
const DIRECT_URL_KEYWORDS = new Set([
  "css", "html", "http", "api", "dom", "svg", "wasm", "webgl", "webrtc", "websocket",
  "fetch", "worker", "storage", "canvas", "audio", "video", "media", "font", "form",
  "grid", "flex", "animation", "transition", "transform", "selector", "pseudo", "layer",
  "container", "nesting", "has", "popover", "dialog", "details", "summary",
  "header", "cors", "csp", "hsts", "cookie", "cache", "redirect", "status",
  "xss", "csrf", "sqli", "ssrf", "injection", "authentication", "authorization", "session",
  "schema", "json-ld", "structured-data", "breadcrumb", "faq", "article", "product",
  "localbusiness", "organization", "howto", "sitelinks", "searchaction",
  "intersection", "resize", "mutation", "observer", "indexeddb", "crypto",
  "service-worker", "push", "notification", "geolocation", "clipboard", "drag",
  "view-transition", "scroll-driven", "speculation", "prerender", "prefetch",
  "lcp", "inp", "cls", "fid", "ttfb", "performance", "vitals", "lazy-loading",
  "accessibility", "aria", "role", "tabindex", "focus", "landmark",
  "sitemap", "robots", "canonical", "hreflang", "noindex", "crawl",
]);

export function buildDirectDocsUrls(query: string): Array<{ url: string; name: string }> {
  const slug = query
    .toLowerCase()
    .replace(/\b(?:best practices|latest|how to|guide|tutorial|docs?|documentation|api|reference)\b/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug || slug.length < 2) return [];

  // Only construct direct URLs when the slug contains a recognized technical term
  const slugWords = slug.split("-");
  const hasKnownTerm = slugWords.some((w) => DIRECT_URL_KEYWORDS.has(w));
  if (!hasKnownTerm) return [];

  const candidates: Array<{ url: string; name: string }> = [];

  // Google Search Developers (SEO, structured data, Search Console)
  candidates.push(
    { url: `https://developers.google.com/search/docs/appearance/structured-data/${slug}`, name: "Google Search Central" },
    { url: `https://developers.google.com/search/docs/${slug}`, name: "Google Search Docs" },
  );

  // MDN Web Docs (the universal web reference)
  candidates.push(
    { url: `https://developer.mozilla.org/en-US/docs/Web/API/${slug.replace(/-/g, "_")}`, name: "MDN Web API" },
    { url: `https://developer.mozilla.org/en-US/docs/Web/CSS/${slug}`, name: "MDN CSS" },
    { url: `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/${slug}`, name: "MDN HTML" },
    { url: `https://developer.mozilla.org/en-US/docs/Web/HTTP/${slug}`, name: "MDN HTTP" },
  );

  // web.dev (performance, best practices)
  candidates.push(
    { url: `https://web.dev/articles/${slug}`, name: "web.dev" },
  );

  // Chrome DevRel (browser APIs, platform features)
  candidates.push(
    { url: `https://developer.chrome.com/docs/web-platform/${slug}`, name: "Chrome DevRel" },
    { url: `https://developer.chrome.com/docs/capabilities/${slug}`, name: "Chrome Capabilities" },
  );

  // OWASP (security)
  candidates.push(
    { url: `https://cheatsheetseries.owasp.org/cheatsheets/${slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_")}_Cheat_Sheet.html`, name: "OWASP Cheat Sheet" },
  );

  // Schema.org (structured data)
  const pascalSlug = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  candidates.push(
    { url: `https://schema.org/${pascalSlug}`, name: "Schema.org" },
  );

  return candidates;
}

/**
 * Build Jina Reader fallback URLs for queries that don't match any known pattern.
 * Uses web.dev search and Google Search Central as last-resort documentation sources.
 */
export function buildJinaFallbackUrls(query: string): Array<{ url: string; name: string }> {
  const encoded = encodeURIComponent(query);
  return [
    { url: `https://web.dev/search?q=${encoded}`, name: "web.dev search" },
    { url: `https://developers.google.com/search?q=${encoded}`, name: "Google Developers search" },
  ];
}
