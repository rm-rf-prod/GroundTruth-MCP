/**
 * Curated remediation URLs per audit-finding class.
 *
 * Each group is tried in order: the first `targets` entry whose regex matches the
 * finding wins, otherwise `fallback` is used. Deep links are deliberate — index
 * and search-result pages carry no remediation content and fail the evidence gate.
 */
export interface FixTargetGroup {
  /** Finding text this group applies to */
  match: RegExp;
  /** Deep links, most specific first */
  targets: Array<[RegExp, string]>;
  /** Broader page used when no target matched, or the matched target came back empty.
   *  A `{q}` placeholder is replaced with the URL-encoded finding. */
  fallback: string;
}

const OWASP = "https://cheatsheetseries.owasp.org/cheatsheets";
const MDN = "https://developer.mozilla.org/en-US/docs";
const TSESLINT = "https://typescript-eslint.io/rules";

export const FIX_TARGET_GROUPS: FixTargetGroup[] = [
  {
    match: /typescript|ts-ignore|floating|promise|require\(\)|assertion|return type|any\b/i,
    targets: [
      [/floating.?promis/i, `${TSESLINT}/no-floating-promises/`],
      [/ts-ignore|ts-expect/i, `${TSESLINT}/ban-ts-comment/`],
      [/require\(\)/i, `${TSESLINT}/no-require-imports/`],
      [/return.?type/i, `${TSESLINT}/explicit-function-return-type/`],
      [/assertion/i, `${TSESLINT}/consistent-type-assertions/`],
      [/\bany\b/i, `${TSESLINT}/no-explicit-any/`],
    ],
    fallback: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html",
  },
  {
    match: /node\.js|event loop|readfile|writefile|process\.exit|callback|pino|winston/i,
    targets: [],
    fallback: `${OWASP}/Nodejs_Security_Cheat_Sheet.html`,
  },
  {
    match: /css|html|dom|aria|wcag|a11y|outline|font|viewport|flexbox|grid|focus|keyboard|lang\b|reduced-motion/i,
    targets: [
      [/aria/i, `${MDN}/Web/Accessibility/ARIA`],
      [/focus|keyboard|outline/i, `${MDN}/Web/Accessibility/Guides/Understanding_WCAG/Keyboard`],
      [/reduced-?motion/i, `${MDN}/Web/CSS/@media/prefers-reduced-motion`],
      [/viewport/i, `${MDN}/Web/HTML/Guides/Viewport_meta_element`],
      [/\balt\b|img|image/i, `${MDN}/Web/API/HTMLImageElement/alt`],
      [/\blang\b/i, `${MDN}/Web/HTML/Reference/Global_attributes/lang`],
      [/wcag|a11y|accessib/i, `${MDN}/Web/Accessibility`],
    ],
    // MDN search is a link list — last resort only, and still evidence-gated.
    fallback: "https://developer.mozilla.org/en-US/search?q={q}",
  },
  {
    match: /xss|sql.inject|command.inject|ssrf|csrf|csp|cors|secret|sanitize|security|rce|path.travers/i,
    targets: [
      [/xss|innerhtml|dangerously/i, `${OWASP}/Cross_Site_Scripting_Prevention_Cheat_Sheet.html`],
      [/sql.?inject/i, `${OWASP}/SQL_Injection_Prevention_Cheat_Sheet.html`],
      [/command.?inject|rce|exec|spawn/i, `${OWASP}/OS_Command_Injection_Defense_Cheat_Sheet.html`],
      [/ssrf/i, `${OWASP}/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`],
      [/csrf/i, `${OWASP}/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html`],
      [/csp|content.?security/i, `${OWASP}/Content_Security_Policy_Cheat_Sheet.html`],
      [/secret|credential|api.?key|token/i, `${OWASP}/Secrets_Management_Cheat_Sheet.html`],
      [/path.?travers|file.?upload/i, `${OWASP}/File_Upload_Cheat_Sheet.html`],
      [/cors/i, `${OWASP}/HTML5_Security_Cheat_Sheet.html`],
      [/sanitiz|validat/i, `${OWASP}/Input_Validation_Cheat_Sheet.html`],
    ],
    fallback: `${OWASP}/Injection_Prevention_Cheat_Sheet.html`,
  },
  {
    match: /performance|lcp|cls|inp|lazy|vitals|bundle|load|fetchpriority|render.blocking/i,
    targets: [
      [/cls|layout.?shift|dimension|aspect/i, "https://web.dev/articles/optimize-cls"],
      [/inp|interaction|long.?task/i, "https://web.dev/articles/optimize-inp"],
      [/bundle|code.?split|chunk|tree.?shak/i, "https://web.dev/articles/reduce-javascript-payloads-with-code-splitting"],
      [/lazy|offscreen/i, "https://web.dev/articles/lazy-loading-images"],
      [/render.?blocking|critical/i, "https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources"],
      [/font/i, "https://web.dev/articles/font-best-practices"],
      [/lcp|largest|fetchpriority|preload|hero/i, "https://web.dev/articles/optimize-lcp"],
    ],
    fallback: "https://web.dev/articles/vitals",
  },
  {
    match: /react.rules|hooks|conditional|reconcil|forwardRef|useActionState/i,
    targets: [],
    fallback: "https://react.dev/reference/rules",
  },
];

/** Python findings fetch both sources in parallel and prefer the security sheet. */
export const PYTHON_FIX_URLS = {
  match: /python|pickle|subprocess|f-string|sql.inject|argon2|bcrypt|bare.except|mutable.default|requests.verify/i,
  security: `${OWASP}/Python_Security_Cheat_Sheet.html`,
  style: "https://peps.python.org/pep-0008/",
} as const;

/** Findings that map to a registry library rather than a curated URL. */
export const KEYWORD_TO_LIB: Array<[RegExp, string]> = [
  [/next\.?js|app router|server action|route handler|async params/i, "vercel/next.js"],
  [/\breact\b/i, "facebook/react"],
  [/tailwind/i, "tailwindlabs/tailwindcss"],
  [/typescript/i, "microsoft/typescript"],
  [/\bzod\b/i, "colinhacks/zod"],
  [/\bswr\b/i, "vercel/swr"],
  [/tanstack|react.query/i, "tanstack/query"],
];
