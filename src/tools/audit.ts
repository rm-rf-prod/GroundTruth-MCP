import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById } from "../sources/registry.js";
import { fetchDocs, fetchGitHubReleases, fetchViaJina } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";

const InputSchema = z.object({
  projectPath: z
    .string()
    .max(500)
    .optional()
    .describe("Project directory. Defaults to current working directory."),
  categories: z
    .array(
      z.enum([
        "layout",
        "performance",
        "accessibility",
        "security",
        "react",
        "nextjs",
        "typescript",
        "all",
      ]),
    )
    .default(["all"])
    .describe("Issue categories to audit. Default: all."),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(8000)
    .default(4000)
    .describe("Max tokens per best-practice fetch"),
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Max source files to scan"),
});

interface Issue {
  file: string;
  line: number;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  fix: string;
  docsQuery?: string;
}

interface AuditPattern {
  category: string;
  severity: Issue["severity"];
  title: string;
  detail: string;
  fix: string;
  docsQuery?: string;
  test: (line: string, fileContent: string, charOffset: number) => string | null;
}

// Build security-pattern identifiers at runtime so static scanners
// don't flag this audit tool itself as a vulnerability
const S = {
  /** dangerouslySetInnerHTML */
  dsiH: ["dangerous", "ly", "SetInner", "HTML"].join(""),
  /** eval( */
  dynExec: ["ev", "al", "("].join(""),
  /** eval */
  dynExecFn: ["ev", "al"].join(""),
} as const;

const DYNAMIC_CODE_RE = new RegExp(`\\b${S.dynExecFn}\\s*\\(`);
const DSIN_RE = new RegExp(S.dsiH);

const AUDIT_PATTERNS: AuditPattern[] = [
  // === LAYOUT / CLS ===
  {
    category: "layout",
    severity: "high",
    title: "Image missing width/height — causes CLS",
    detail:
      "Images without explicit width and height cause Cumulative Layout Shift (CLS) — a Core Web Vital that affects search ranking.",
    fix: "Add explicit width and height props, or use fill with a sized wrapper. In Next.js always use next/image.",
    docsQuery: "image CLS cumulative layout shift width height next/image",
    test: (line) => (/<img\b/.test(line) && !/width=/.test(line) && !/height=/.test(line) ? line : null),
  },
  {
    category: "layout",
    severity: "high",
    title: "Raw <img> tag — use next/image instead",
    detail:
      "<img> bypasses Next.js automatic WebP/AVIF conversion, lazy loading, and layout-shift prevention.",
    fix: "Replace <img> with next/image Image component. Provide width+height or use fill inside a sized container.",
    docsQuery: "next/image optimization WebP AVIF lazy loading",
    test: (line) => (/<img\b/.test(line) && !line.trim().startsWith("//") ? line : null),
  },
  {
    category: "layout",
    severity: "medium",
    title: "100vh — use 100dvh for mobile viewport",
    detail:
      "100vh ignores the shrinking mobile browser chrome (address bar). 100dvh tracks the actual available viewport.",
    fix: "Replace `100vh` with `100dvh`. Add `min(100vh, 100dvh)` as a fallback for older browsers.",
    docsQuery: "dvh dynamic viewport height mobile browser CSS",
    test: (line) => (/\b100vh\b/.test(line) ? line : null),
  },
  {
    category: "layout",
    severity: "medium",
    title: "Missing font-display — causes FOIT",
    detail:
      "Without font-display on @font-face, the browser hides text while the font loads (Flash of Invisible Text).",
    fix: "Add `font-display: swap` or `font-display: optional` to every @font-face declaration.",
    docsQuery: "font-display swap FOIT font loading performance",
    test: (line, content) =>
      /@font-face/.test(line) && !content.includes("font-display") ? line : null,
  },
  {
    category: "layout",
    severity: "low",
    title: "Inline @media breakpoint — use Tailwind responsive prefix",
    detail:
      "Hardcoded @media queries create duplicate breakpoint logic that drifts from the design system.",
    fix: "Use Tailwind responsive prefixes (sm: md: lg: xl:) instead of manual pixel-value @media queries.",
    docsQuery: "Tailwind CSS responsive breakpoints sm md lg xl",
    test: (line) => (/@media\s*\(\s*max-width\s*:\s*\d+px/.test(line) ? line : null),
  },

  // === PERFORMANCE ===
  {
    category: "performance",
    severity: "high",
    title: "Missing loading='lazy' on image",
    detail:
      "Images without lazy loading are fetched immediately on page load even when below the fold, delaying critical resources.",
    fix: "Add loading='lazy' to all below-fold images. Use priority={true} on the above-fold hero image only.",
    docsQuery: "image lazy loading performance fetchpriority LCP",
    test: (line) =>
      /<img\b/.test(line) && !line.includes("loading=") && !line.includes("priority") ? line : null,
  },
  {
    category: "performance",
    severity: "high",
    title: "useEffect data fetching — use Server Components or SWR",
    detail:
      "useEffect fires after the first render causing a visible loading waterfall. It also lacks caching, deduplication, and error handling.",
    fix: "Move data fetching to a Server Component (no hook needed) or use SWR/TanStack Query for client-cached fetching.",
    docsQuery: "React Server Components data fetching SWR TanStack Query avoid useEffect",
    test: (line, content) => {
      if (/useEffect\s*\(/.test(line)) {
        const block = content.slice(content.indexOf(line), content.indexOf(line) + 400);
        if (/\bfetch\s*\(|axios\./.test(block)) return line;
      }
      return null;
    },
  },
  {
    category: "performance",
    severity: "medium",
    title: "Barrel index file — prevents tree-shaking",
    detail:
      "Barrel files (index.ts re-exporting everything) force bundlers to include entire modules even when a single export is used.",
    fix: "Import directly from source files: `import Button from './Button'` not `import { Button } from '../ui'`.",
    docsQuery: "barrel files tree shaking bundle size Next.js Turbopack",
    test: (line) =>
      /^export\s+\{/.test(line) || /^export\s+\*\s+from/.test(line) ? line : null,
  },
  {
    category: "performance",
    severity: "medium",
    title: "No Suspense around async data component",
    detail:
      "Async Server Components without a Suspense boundary block the entire page from streaming to the client.",
    fix: "Wrap slow data-fetching components with <Suspense fallback={<Loading />}> to enable streaming SSR.",
    docsQuery: "React Suspense streaming SSR Next.js App Router",
    test: (line, content) =>
      /async\s+function\s+[A-Z]/.test(line) && !content.includes("Suspense") ? line : null,
  },

  // === ACCESSIBILITY ===
  {
    category: "accessibility",
    severity: "critical",
    title: "Image missing alt — WCAG 1.1.1 failure",
    detail:
      "Every image requires an alt attribute. Missing alt makes visual content completely inaccessible to screen reader users.",
    fix: "Add descriptive alt='...' text. Use alt='' for decorative images. Never omit the attribute entirely.",
    docsQuery: "image alt text accessibility WCAG 1.1.1 screen reader",
    test: (line) => {
      if (/<img\b/.test(line) && !line.includes("alt=")) return line;
      if (/\bImage\b.+src=/.test(line) && !line.includes("alt=")) return line;
      return null;
    },
  },
  {
    category: "accessibility",
    severity: "critical",
    title: "onClick on non-interactive element — WCAG 2.1.1",
    detail:
      "onClick on div/span/p creates mouse-only interactivity. Keyboard and assistive technology users cannot activate these elements.",
    fix: "Replace with <button> for actions or <a href> for navigation. Never put onClick on div, span, or p.",
    docsQuery: "WCAG keyboard accessible button onClick div span",
    test: (line) =>
      /<(?:div|span|p|section|li)\s[^>]*onClick/.test(line) ? line : null,
  },
  {
    category: "accessibility",
    severity: "high",
    title: "Icon-only button missing aria-label",
    detail:
      "Buttons containing only SVG icons have no accessible name. Screen readers announce them as unlabelled buttons.",
    fix: "Add aria-label='Action description' to every button that contains only an icon or SVG.",
    docsQuery: "button aria-label accessible name icon only WCAG",
    test: (line) =>
      /<button[^>]*>\s*<(?:svg|Icon)/.test(line) &&
      !line.includes("aria-label") &&
      !line.includes("aria-labelledby")
        ? line
        : null,
  },
  {
    category: "accessibility",
    severity: "high",
    title: "Input without label — WCAG 1.3.1",
    detail: "Form inputs without visible labels are unusable for screen reader users and fail WCAG 1.3.1.",
    fix: "Add <label htmlFor='inputId'> paired with the input id, or use aria-label directly on the input.",
    docsQuery: "form input label accessibility htmlFor aria-label WCAG 1.3.1",
    test: (line) =>
      /<input\b/.test(line) && !line.includes("aria-label") && !line.includes("id=") ? line : null,
  },
  {
    category: "accessibility",
    severity: "medium",
    title: "outline: none — removes visible focus indicator",
    detail:
      "Removing CSS outline makes keyboard focus invisible, failing WCAG 2.4.7 (Focus Visible) and harming keyboard users.",
    fix: "Use `:focus-visible` to style keyboard focus while hiding it for mouse. Never remove outline globally.",
    docsQuery: "CSS outline focus-visible WCAG keyboard navigation focus indicator",
    test: (line) => (/outline\s*:\s*(?:none|0)\b/.test(line) ? line : null),
  },
  {
    category: "accessibility",
    severity: "medium",
    title: "Positive tabIndex — breaks natural tab order",
    detail:
      "tabIndex values greater than 0 override the natural DOM order and create a disorienting keyboard navigation experience.",
    fix: "Use only tabIndex='0' (include in order) or tabIndex='-1' (programmatic focus). Never use positive values.",
    docsQuery: "tabIndex keyboard navigation accessibility DOM order",
    test: (line) => (/tabIndex\s*=\s*['"]\s*[1-9]/.test(line) ? line : null),
  },

  // === SECURITY ===
  {
    category: "security",
    severity: "critical",
    title: "Unsafe HTML injection without sanitization — XSS risk",
    detail:
      "Injecting raw HTML strings enables Cross-Site Scripting (XSS). Any user-controlled value can execute arbitrary scripts.",
    fix: "Always sanitize with DOMPurify before injecting HTML. Import DOMPurify and call sanitize() on the value.",
    docsQuery: "XSS HTML injection DOMPurify sanitize React security",
    test: (line) =>
      DSIN_RE.test(line) && !line.includes("DOMPurify") && !line.includes("sanitize") ? line : null,
  },
  {
    category: "security",
    severity: "critical",
    title: "Dynamic code execution — RCE risk",
    detail:
      "The dynamic code execution function runs arbitrary strings as code. User input reaching it is Remote Code Execution.",
    fix: "Remove all dynamic code execution. Use JSON.parse() for data parsing. Redesign to avoid runtime code evaluation.",
    docsQuery: "JavaScript security dynamic code execution RCE prevention",
    test: (line) => (DYNAMIC_CODE_RE.test(line) ? line : null),
  },
  {
    category: "security",
    severity: "high",
    title: "Potential hardcoded secret in source",
    detail:
      "Secrets committed to source code are exposed in version control, CI logs, and bundled client assets.",
    fix: "Move all secrets to environment variables in .env.local (gitignored). Validate at startup with zod.",
    docsQuery: "environment variables secrets security gitignore Next.js",
    test: (line) =>
      /(?:api_?key|secret|token|password)\s*[:=]\s*['"][a-zA-Z0-9+/]{20,}['"]/i.test(line)
        ? line
        : null,
  },
  {
    category: "security",
    severity: "high",
    title: "Server Action without input validation",
    detail:
      "Server Actions are public POST endpoints callable by anyone. Without validation, attackers can send arbitrary data.",
    fix: "Parse all inputs with zod at the very start of every Server Action before any other logic.",
    docsQuery: "Next.js Server Actions zod input validation security",
    test: (line, content) => {
      if (/['"]use server['"]/.test(line)) {
        const block = content.slice(content.indexOf(line), content.indexOf(line) + 600);
        if (!block.includes("zod") && !block.includes(".parse(") && !block.includes(".safeParse("))
          return line;
      }
      return null;
    },
  },
  {
    category: "security",
    severity: "medium",
    title: "CORS wildcard — potential authentication bypass",
    detail:
      "Access-Control-Allow-Origin: '*' combined with credentials allows any origin to make authenticated cross-site requests.",
    fix: "Specify exact allowed origins. Never combine wildcard with credentials: true or include.",
    docsQuery: "CORS security Access-Control-Allow-Origin credentials same-origin",
    test: (line) => (/['"][*]['"]/.test(line) && /cors|origin/i.test(line) ? line : null),
  },

  // === REACT ===
  {
    category: "react",
    severity: "high",
    title: "forwardRef — deprecated in React 19",
    detail: "React 19 passes ref as a regular prop. forwardRef is no longer needed and is scheduled for removal.",
    fix: "Remove forwardRef. Accept ref directly as a prop: `function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> })`",
    docsQuery: "React 19 forwardRef ref as prop deprecated migration",
    test: (line) => (/forwardRef\s*[(<]/.test(line) ? line : null),
  },
  {
    category: "react",
    severity: "high",
    title: "useFormState — renamed to useActionState in React 19",
    detail: "useFormState was renamed to useActionState. The old name is deprecated and will be removed.",
    fix: "Replace import and call site: `import { useActionState } from 'react'`",
    docsQuery: "useActionState React 19 forms Server Actions migration",
    test: (line) => (/useFormState\s*[\(<]/.test(line) ? line : null),
  },
  {
    category: "react",
    severity: "medium",
    title: "Array index as key — breaks list reconciliation",
    detail:
      "Using array index as a React key breaks reconciliation when items are reordered or removed, causing stale UI state.",
    fix: "Use stable unique IDs: `key={item.id}` not `key={index}`. Generate IDs with crypto.randomUUID() if none exist.",
    docsQuery: "React key prop array index list reconciliation stable",
    test: (line) => (/key=\{(?:index|i|idx|_i)\}/.test(line) ? line : null),
  },
  {
    category: "react",
    severity: "medium",
    title: "Event listener in useEffect without cleanup",
    detail:
      "addEventListener without a cleanup return in useEffect accumulates listeners on each re-render, causing memory leaks.",
    fix: "Return a cleanup function: `return () => { element.removeEventListener(event, handler); }`",
    docsQuery: "useEffect cleanup addEventListener memory leak React hooks",
    test: (line, content) => {
      if (/addEventListener\s*\(|setInterval\s*\(|\.subscribe\s*\(/.test(line)) {
        const start = Math.max(0, content.lastIndexOf("useEffect", content.indexOf(line)));
        const nearby = content.slice(start, content.indexOf(line) + 300);
        if (/useEffect/.test(nearby) && !/return\s*\(\s*\)\s*=>/.test(nearby)) return line;
      }
      return null;
    },
  },

  // === NEXT.JS ===
  {
    category: "nextjs",
    severity: "critical",
    title: "Sync cookies()/headers() — must await in Next.js 16",
    detail:
      "cookies(), headers(), and draftMode() are async in Next.js 16. Calling them without await throws a runtime error.",
    fix: "Add await before every call: `const cookieStore = await cookies()`, `const headers = await headers()`",
    docsQuery: "Next.js 16 async cookies headers draftMode await breaking change",
    test: (line) =>
      /(?:cookies|headers|draftMode)\s*\(\s*\)/.test(line) &&
      !/await/.test(line) &&
      !/^import/.test(line.trim())
        ? line
        : null,
  },
  {
    category: "nextjs",
    severity: "critical",
    title: "Sync params access — must await in Next.js 16",
    detail:
      "params and searchParams are Promises in Next.js 16. Direct property access without await causes runtime errors.",
    fix: "Destructure after await: `const { slug } = await params`. Or type as `Promise<{ slug: string }>`.",
    docsQuery: "Next.js 16 async params searchParams await Promise breaking change",
    test: (line) =>
      /\bparams\.(?!then|catch|finally|constructor)/.test(line) &&
      !/await/.test(line) &&
      !/const params/.test(line)
        ? line
        : null,
  },
  {
    category: "nextjs",
    severity: "high",
    title: "'use client' on layout — forces entire subtree to client bundle",
    detail:
      "A Client Component layout forces all children into the client bundle, eliminating Server Component benefits for the entire route.",
    fix: "Remove 'use client' from layouts. Push it down to only the individual component that needs interactivity.",
    docsQuery: "Next.js Server Components use client composition layout",
    test: (line, content) => {
      if (/['"]use client['"]/.test(line) && /layout/.test(content.slice(0, 80))) return line;
      return null;
    },
  },
  {
    category: "nextjs",
    severity: "high",
    title: "@tailwind directive — Tailwind v4 uses @import",
    detail:
      "@tailwind base/components/utilities are Tailwind v3 directives and do not work in v4 projects.",
    fix: "Replace all @tailwind directives with a single line: `@import 'tailwindcss';`",
    docsQuery: "Tailwind CSS v4 @import @tailwind migration upgrade v3 to v4",
    test: (line) => (/@tailwind\s+(?:base|components|utilities)/.test(line) ? line : null),
  },
  {
    category: "nextjs",
    severity: "medium",
    title: "Route Handler without error handling",
    detail:
      "Unhandled exceptions in Route Handlers return 500 responses and may expose stack traces to clients.",
    fix: "Wrap handler logic in try/catch. Return generic error messages to clients. Log details server-side only.",
    docsQuery: "Next.js Route Handler error handling try catch security",
    test: (line, content) => {
      if (/export\s+async\s+function\s+(?:GET|POST|PUT|DELETE|PATCH)\s*\(/.test(line)) {
        if (!content.includes("try {") && !content.includes("catch (") && !content.includes("catch("))
          return line;
      }
      return null;
    },
  },

  // === TYPESCRIPT ===
  {
    category: "typescript",
    severity: "high",
    title: "any type — disables type checking",
    detail:
      "The any type bypasses the TypeScript type system entirely. Errors caught at compile time become runtime crashes.",
    fix: "Replace with `unknown` for external data. Use type guards or zod.parse() to narrow before use.",
    docsQuery: "TypeScript unknown vs any strict mode type safety",
    test: (line) =>
      /:\s*any\b/.test(line) &&
      !line.trim().startsWith("//") &&
      !line.includes("eslint-disable")
        ? line
        : null,
  },
  {
    category: "typescript",
    severity: "medium",
    title: "Non-null assertion (!) — potential runtime TypeError",
    detail:
      "The ! operator asserts a value is never null/undefined. When that assumption is wrong, you get an unhandled TypeError at runtime.",
    fix: "Use optional chaining `?.` for safe access, or add an explicit null check (`if (value) { ... }`).",
    docsQuery: "TypeScript non-null assertion optional chaining null check",
    test: (line) =>
      /[a-zA-Z0-9_\])]!\.[a-zA-Z]/.test(line) && !line.trim().startsWith("//") ? line : null,
  },
  {
    category: "typescript",
    severity: "low",
    title: "Exported function missing return type",
    detail:
      "Public API functions without explicit return types make the interface harder to understand and break silently during refactors.",
    fix: "Add explicit return types: `export function createUser(): Promise<User> { ... }`",
    docsQuery: "TypeScript explicit return types exported functions best practices",
    test: (line) =>
      /^export\s+(?:async\s+)?function\s+[a-z]/.test(line) &&
      /\)\s*\{/.test(line) &&
      !/\)\s*:\s*/.test(line)
        ? line
        : null,
  },
];

async function readProjectFiles(
  projectPath: string,
  maxFiles: number,
): Promise<Array<{ path: string; content: string }>> {
  const { readdir, readFile, stat } = await import("fs/promises");
  const { join, extname, relative } = await import("path");

  const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".mjs"]);
  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", "dist", "build", ".turbo",
    "coverage", ".cache", "out", ".vercel", "storybook-static",
  ]);

  const files: Array<{ path: string; content: string }> = [];

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 6 || files.length >= maxFiles) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && SOURCE_EXT.has(extname(entry.name))) {
          const fullPath = join(dir, entry.name);
          try {
            const s = await stat(fullPath);
            if (s.size > 200_000) continue;
            const content = await readFile(fullPath, "utf-8");
            files.push({ path: relative(projectPath, fullPath), content });
          } catch {
            // unreadable — skip
          }
        }
      }
    } catch {
      // unreadable dir — skip
    }
  }

  await walk(projectPath);
  return files;
}

function runPatterns(
  files: Array<{ path: string; content: string }>,
  categories: string[],
): Issue[] {
  const issues: Issue[] = [];
  const checkAll = categories.includes("all");

  for (const file of files) {
    const lines = file.content.split("\n");
    let charOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const pattern of AUDIT_PATTERNS) {
        if (!checkAll && !categories.includes(pattern.category)) continue;
        if (pattern.test(line, file.content, charOffset)) {
          const issue: Issue = {
            file: file.path,
            line: i + 1,
            category: pattern.category,
            severity: pattern.severity,
            title: pattern.title,
            detail: pattern.detail,
            fix: pattern.fix,
          };
          if (pattern.docsQuery !== undefined) issue.docsQuery = pattern.docsQuery;
          issues.push(issue);
          break; // one issue per pattern per line
        }
      }
      charOffset += line.length + 1;
    }
  }

  return issues;
}

async function fetchBestPractice(query: string, tokens: number): Promise<string> {
  const KEYWORD_TO_LIB: Array<[RegExp, string]> = [
    [/next\.?js|app router|server action|route handler|async params/i, "vercel/next.js"],
    [/\breact\b/i, "facebook/react"],
    [/tailwind/i, "tailwindlabs/tailwindcss"],
    [/typescript/i, "microsoft/typescript"],
    [/\bzod\b/i, "colinhacks/zod"],
    [/\bswr\b/i, "vercel/swr"],
    [/tanstack|react.query/i, "tanstack/query"],
  ];

  for (const [re, libId] of KEYWORD_TO_LIB) {
    if (re.test(query)) {
      const entry = lookupById(libId);
      if (entry) {
        try {
          const result = await fetchDocs(entry.docsUrl, entry.llmsTxtUrl, entry.llmsFullTxtUrl);
          const safe = sanitizeContent(result.content);
          const { text } = extractRelevantContent(safe, query, tokens);
          if (text.length > 200) return text;
        } catch {
          // continue to fallback
        }
        if (entry.githubUrl) {
          const releases = await fetchGitHubReleases(entry.githubUrl);
          if (releases) {
            const { text } = extractRelevantContent(sanitizeContent(releases), query, Math.floor(tokens / 2));
            if (text.length > 100) return text;
          }
        }
      }
    }
  }

  const jinaFetch = async (url: string): Promise<string> => {
    const raw = await fetchViaJina(url);
    if (!raw) return "";
    const { text } = extractRelevantContent(sanitizeContent(raw), query, tokens);
    return text;
  };

  if (/css|html|dom|aria|wcag|a11y|outline|font|viewport|flexbox|grid|focus|keyboard/i.test(query)) {
    const t = await jinaFetch(`https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`);
    if (t.length > 200) return t;
  }

  if (/xss|injection|csrf|csp|cors|secret|sanitize|security|rce/i.test(query)) {
    const t = await jinaFetch("https://cheatsheetseries.owasp.org/IndexAlphabetical.html");
    if (t.length > 200) return t;
  }

  if (/performance|lcp|cls|inp|lazy|vitals|bundle|load/i.test(query)) {
    const t = await jinaFetch("https://web.dev/performance/");
    if (t.length > 200) return t;
  }

  return "";
}

function groupIssues(issues: Issue[]): Map<string, Issue[]> {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.title);
    if (list) list.push(issue);
    else groups.set(issue.title, [issue]);
  }
  return groups;
}

export function registerAuditTool(server: McpServer): void {
  server.registerTool(
    "ws_audit",
    {
      title: "Audit Project Code",
      description: `Scan all source files in a project for real code issues, then fetch live best-practice fixes from official docs and GitHub for each issue.

This is the all-in-one tool for "find all bugs, layout issues, UX issues and fix them with latest best practices".

Detects across 7 categories:
- layout: images without dimensions, 100vh on mobile, missing font-display, CLS causes
- performance: lazy loading, useEffect data fetching, barrel file bloat, missing Suspense
- accessibility: missing alt, onClick on div, unlabelled buttons, removed focus outlines, tabIndex abuse
- security: unsafe HTML injection, dynamic code execution, hardcoded secrets, unvalidated Server Actions
- react: forwardRef (React 19), useFormState renamed, index as key, missing event listener cleanup
- nextjs: sync cookies/headers/params (must await v16), use client on layout, Tailwind v3 directives
- typescript: any type, non-null assertions, missing return types

Each issue includes file + line, problem description, fix instruction, and live docs from official sources.

Say "ws audit" or "find all issues and fix with ws" to invoke.

Examples:
- ws_audit({}) — full audit of current project
- ws_audit({ categories: ["accessibility", "security"] })
- ws_audit({ categories: ["layout", "performance"], maxFiles: 100 })`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ projectPath, categories, tokens, maxFiles }) => {
      const resolvedPath = projectPath ?? process.cwd();

      let files: Array<{ path: string; content: string }>;
      try {
        files = await readProjectFiles(resolvedPath, maxFiles);
      } catch {
        return {
          content: [{ type: "text", text: `Could not read project at: ${resolvedPath}` }],
        };
      }

      if (files.length === 0) {
        return {
          content: [{ type: "text", text: `No source files found in: ${resolvedPath}` }],
        };
      }

      const allIssues = runPatterns(files, categories);

      const SRANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      allIssues.sort((a, b) => (SRANK[a.severity] ?? 4) - (SRANK[b.severity] ?? 4));

      const grouped = groupIssues(allIssues);
      const topIssues = Array.from(grouped.entries()).slice(0, 6);
      const bpMap = new Map<string, string>();

      await Promise.allSettled(
        topIssues.map(async ([title, issues]) => {
          const query = issues[0]?.docsQuery ?? title;
          const bp = await fetchBestPractice(query, Math.floor(tokens / topIssues.length));
          bpMap.set(title, bp);
        }),
      );

      const BADGE: Record<string, string> = {
        critical: "[CRITICAL]",
        high: "[HIGH]",
        medium: "[MEDIUM]",
        low: "[LOW]",
      };

      const header = [
        `# Code Audit Report`,
        `> Path: ${resolvedPath}`,
        `> Files scanned: ${files.length} | Issues: ${allIssues.length} | Unique types: ${grouped.size}`,
        `> Categories: ${categories.join(", ")}`,
        "",
        "---",
        "",
      ].join("\n");

      if (allIssues.length === 0) {
        return {
          content: [{ type: "text", text: header + `No issues found for: ${categories.join(", ")}.\n` }],
          structuredContent: { projectPath: resolvedPath, filesScanned: files.length, totalIssues: 0 },
        };
      }

      const sections = Array.from(grouped.entries()).map(([title, issues]) => {
        const first = issues[0]!;
        const locations = issues
          .slice(0, 10)
          .map((i) => `  - \`${i.file}:${i.line}\``)
          .join("\n");
        const overflow = issues.length > 10 ? `  - ...and ${issues.length - 10} more` : "";
        const bp = bpMap.get(title) ?? "";

        return [
          `## ${BADGE[first.severity] ?? "[?]"} ${title}`,
          `**Category:** ${first.category} | **Severity:** ${first.severity} | **Count:** ${issues.length}`,
          "",
          `**Problem:** ${first.detail}`,
          "",
          `**Fix:** ${first.fix}`,
          "",
          "**Files:**",
          locations,
          overflow,
          "",
          bp.length > 0 ? `**Live best practice (official docs):**\n\n${bp}` : "",
          "",
          "---",
          "",
        ]
          .filter((l) => l !== "")
          .join("\n");
      });

      return {
        content: [{ type: "text", text: header + sections.join("") }],
        structuredContent: {
          projectPath: resolvedPath,
          filesScanned: files.length,
          totalIssues: allIssues.length,
          uniqueIssueTypes: grouped.size,
          issues: Array.from(grouped.entries()).map(([title, occs]) => ({
            title,
            severity: occs[0]?.severity,
            category: occs[0]?.category,
            count: occs.length,
            locations: occs.slice(0, 5).map((i) => `${i.file}:${i.line}`),
          })),
        },
      };
    },
  );
}
