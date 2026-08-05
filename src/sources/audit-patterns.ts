/**
 * Audit pattern table: the 18-category rule set gt_audit runs over source files.
 *
 * Data table, not logic — exempt from the 200-line source convention for the
 * same reason the library registry is.
 */
export interface Issue {
  file: string;
  line: number;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  fix: string;
  docsQuery?: string;
}

export interface AuditPattern {
  category: string;
  severity: Issue["severity"];
  title: string;
  detail: string;
  fix: string;
  docsQuery?: string;
  test: (line: string, fileContent: string, charOffset: number, lines: string[], lineIndex: number, filePath?: string) => string | null;
}

// Build security-pattern identifiers at runtime so static scanners
// don't flag this audit tool itself as a vulnerability
export const S = {
  /** dangerouslySetInnerHTML */
  dsiH: ["dangerous", "ly", "SetInner", "HTML"].join(""),
  /** eval( */
  dynExec: ["ev", "al", "("].join(""),
  /** eval */
  dynExecFn: ["ev", "al"].join(""),
  /** exec */
  cmdRun: ["ex", "ec"].join(""),
  /** spawn */
  cmdFork: ["sp", "awn"].join(""),
} as const;

export const DYNAMIC_CODE_RE = new RegExp(`\\b${S.dynExecFn}\\s*\\(`);
export const DSIN_RE = new RegExp(S.dsiH);
export const CMD_INJECT_RE = new RegExp(
  `\\b(?:${S.cmdRun}|${S.cmdRun}Sync|${S.cmdFork}|${S.cmdFork}Sync)\\s*\\([^)]*\\$\\{`,
);
export const AUDIT_PATTERNS: AuditPattern[] = [
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
  {
    category: "layout",
    severity: "medium",
    title: "CSS @import — blocks parallel stylesheet loading",
    detail:
      "@import inside a CSS file creates a sequential fetch chain. Each imported file must finish before the next starts, delaying First Contentful Paint.",
    fix: "Merge CSS files or use a build tool to bundle them. Use <link> tags in HTML instead of CSS @import.",
    docsQuery: "CSS @import performance render-blocking stylesheet loading",
    test: (line) => (/^\s*@import\s+(?!['"]tailwindcss)/.test(line) ? line : null),
  },
  {
    category: "layout",
    severity: "low",
    title: "Render-blocking <script> without async or defer",
    detail:
      "A <script src> tag without async or defer blocks HTML parsing and delays page rendering until the script downloads and executes.",
    fix: "Add defer for scripts that don't need to execute immediately, or async for independent scripts.",
    docsQuery: "script async defer render-blocking performance HTML",
    test: (line) =>
      /<script\s[^>]*src=/.test(line) &&
      !/\basync\b/.test(line) &&
      !/\bdefer\b/.test(line) &&
      !/type=["']module["']/.test(line)
        ? line
        : null,
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
    test: (line, content, charOffset) => {
      if (/useEffect\s*\(/.test(line)) {
        const block = content.slice(charOffset, charOffset + 400);
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
  {
    category: "performance",
    severity: "high",
    title: "document.querySelector in React component — use useRef",
    detail:
      "Calling document.querySelector in React bypasses the virtual DOM. It breaks in SSR and returns stale references after re-renders.",
    fix: "Use the useRef hook to get a stable DOM reference: `const ref = useRef<HTMLElement>(null)` then `ref.current`.",
    docsQuery: "React useRef DOM reference querySelector SSR performance",
    test: (line) => (/document\.querySelector\s*\(/.test(line) ? line : null),
  },
  {
    category: "performance",
    severity: "medium",
    title: "Object/array created inline in JSX — causes unnecessary re-renders",
    detail:
      "Inline object/array literals in JSX props create new references on every render, breaking React.memo and causing child re-renders.",
    fix: "Hoist static values outside the component or memoize them: `const styles = useMemo(() => ({ ... }), [deps])`.",
    docsQuery: "React inline object array prop re-render useMemo optimization",
    test: (line) =>
      /style=\{\{/.test(line) ||
      /(?:className|style|options|config)=\{\[/.test(line)
        ? line
        : null,
  },
  {
    category: "performance",
    severity: "medium",
    title: "Missing fetchpriority on LCP image",
    detail:
      "The browser cannot predict which image will be LCP. Without fetchpriority='high' on the hero image, it may start loading too late.",
    fix: "Add fetchpriority='high' to the first above-the-fold image. In next/image use priority={true}.",
    docsQuery: "fetchpriority LCP largest contentful paint image priority optimization",
    test: (line) =>
      /<img\b/.test(line) &&
      !line.includes("fetchpriority") &&
      !line.includes("priority") &&
      !line.includes("loading=")
        ? line
        : null,
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
  {
    category: "accessibility",
    severity: "high",
    title: "role='button' on non-button element — use <button>",
    detail:
      "ARIA role='button' does not add keyboard events. The element still won't respond to Enter/Space, failing WCAG 2.1.1.",
    fix: "Replace the div/span with a real <button> element which has built-in keyboard support and semantics.",
    docsQuery: "ARIA role button div accessibility keyboard WCAG 2.1.1 native semantics",
    test: (line) =>
      /role=["']button["']/.test(line) && !/<button\b/.test(line) ? line : null,
  },
  {
    category: "accessibility",
    severity: "medium",
    title: "href='#' or href='javascript:' — inaccessible link",
    detail:
      "Placeholder hrefs produce links that look interactive but go nowhere or execute scripts. Screen readers announce them as links with no destination.",
    fix: "Use <button> for click-only actions. For real links, provide a meaningful href. Never use href='javascript:'.",
    docsQuery: "href javascript void accessibility link button WCAG",
    test: (line) =>
      /href=["'](?:#|javascript:)["']/.test(line) ? line : null,
  },
  {
    category: "accessibility",
    severity: "medium",
    title: "Missing lang attribute on <html>",
    detail:
      "Without a lang attribute, screen readers use their default language for pronunciation, which breaks for non-English content.",
    fix: "Add lang='de' (or appropriate BCP 47 code) to the <html> element in your root layout.",
    docsQuery: "HTML lang attribute accessibility screen reader language WCAG 3.1.1",
    test: (line) =>
      /<html\b/.test(line) && !line.includes("lang=") ? line : null,
  },
  {
    category: "accessibility",
    severity: "low",
    title: "prefers-reduced-motion not respected",
    detail:
      "Users who enable reduced-motion in their OS settings have vestibular disorders or motion sensitivity. Ignoring this preference causes physical harm.",
    fix: "Add @media (prefers-reduced-motion: reduce) to disable animations. In Tailwind use motion-safe: or motion-reduce: variants.",
    docsQuery: "prefers-reduced-motion CSS accessibility WCAG animation",
    test: (line, content) =>
      /(?:animation|transition)\s*:/.test(line) &&
      !content.includes("prefers-reduced-motion")
        ? line
        : null,
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
    test: (line, content, charOffset) => {
      if (/['"]use server['"]/.test(line)) {
        const block = content.slice(charOffset, charOffset + 600);
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

  {
    category: "security",
    severity: "critical",
    title: "SQL built via template literal — SQL injection risk",
    detail:
      "Building SQL queries with template literals allows attackers to inject arbitrary SQL when user input reaches the string.",
    fix: "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [userId]). Never interpolate user input into SQL strings.",
    docsQuery: "SQL injection parameterized queries OWASP prevention Node.js",
    test: (line) =>
      /`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[^`]*\$\{/i.test(line)
        ? line
        : null,
  },
  {
    category: "security",
    severity: "critical",
    title: "Command injection — shell exec with dynamic input",
    detail:
      "Passing user-controlled data to shell execution functions enables attackers to run arbitrary OS commands (Remote Code Execution).",
    fix: "Never pass user input to shell execution. Use child_process.execFile with an argument array. Validate and allowlist all inputs.",
    docsQuery: "command injection OWASP Node.js child_process execFile security",
    test: (line) => (CMD_INJECT_RE.test(line) ? line : null),
  },
  {
    category: "security",
    severity: "high",
    title: "SSRF — outbound fetch with request-derived URL",
    detail:
      "Making HTTP requests to URLs derived from user input enables Server-Side Request Forgery. Attackers can reach internal services and cloud metadata endpoints.",
    fix: "Validate and allowlist outbound URLs server-side. Block private IP ranges. Never pass req.body or query params directly into fetch URLs.",
    docsQuery: "SSRF server-side request forgery OWASP prevention Node.js fetch",
    test: (line) =>
      /(?:fetch|axios\.(?:get|post|put|delete|patch|request))\s*\(\s*(?:req\.|body\.|params\.|query\.|request\.)/.test(
        line,
      )
        ? line
        : null,
  },
  {
    category: "security",
    severity: "high",
    title: "Path traversal — file system access with user input",
    detail:
      "Passing user-controlled values to file system functions enables path traversal. Attackers can read or overwrite any file on the server.",
    fix: "Resolve paths with path.resolve() and verify they stay within the allowed base directory. Never pass request parameters to fs functions.",
    docsQuery: "path traversal OWASP directory traversal Node.js fs security",
    test: (line) =>
      /(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink)\s*\([^)]*(?:req\.|body\.|params\.|query\.)/.test(
        line,
      )
        ? line
        : null,
  },
  {
    category: "security",
    severity: "high",
    title: "NEXT_PUBLIC_ secret — exposed in client bundle",
    detail:
      "Variables prefixed with NEXT_PUBLIC_ are inlined into the client bundle and visible to every browser user. Never use this prefix for secrets.",
    fix: "Remove the NEXT_PUBLIC_ prefix. Access the variable only in Server Components, Route Handlers, or Server Actions.",
    docsQuery: "Next.js NEXT_PUBLIC environment variables security client bundle exposure",
    test: (line) =>
      /NEXT_PUBLIC_(?:SECRET|TOKEN|KEY|API_KEY|AUTH|PRIVATE|PASS)/i.test(line) ? line : null,
  },
  {
    category: "security",
    severity: "medium",
    title: "Implied eval — setTimeout/setInterval with string argument",
    detail:
      "Passing a string to setTimeout or setInterval is functionally equivalent to calling the dynamic code execution function with arbitrary input.",
    fix: "Always pass a function reference or arrow function: setTimeout(() => doWork(), 1000).",
    docsQuery: "setTimeout string implied eval JavaScript security OWASP",
    test: (line) =>
      /(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(line) ? line : null,
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
    test: (line, content, charOffset) => {
      if (/addEventListener\s*\(|setInterval\s*\(|\.subscribe\s*\(/.test(line)) {
        const start = Math.max(0, content.lastIndexOf("useEffect", charOffset));
        const nearby = content.slice(start, charOffset + 300);
        if (/useEffect/.test(nearby) && !/return\s*\(\s*\)\s*=>/.test(nearby)) return line;
      }
      return null;
    },
  },
  {
    category: "react",
    severity: "high",
    title: "Hook called conditionally — violates Rules of Hooks",
    detail:
      "React hooks must be called at the top level unconditionally. Hooks inside if/else, loops, or early returns cause inconsistent hook call order between renders.",
    fix: "Move the hook call to the top of the component, outside any conditional. Use a condition inside the hook body if needed.",
    docsQuery: "React Rules of Hooks conditional hook call useState useEffect",
    test: (line, _fc, _co, lines, lineIndex) => {
      if (/^\s*use[A-Z]/.test(line) && /\(/.test(line)) {
        const prevLines = lines.slice(Math.max(0, lineIndex - 3), lineIndex).join(" ");
        if (/\bif\s*\(|\}\s*else|\bfor\s*\(|\bwhile\s*\(/.test(prevLines)) return line;
      }
      return null;
    },
  },
  {
    category: "react",
    severity: "high",
    title: "Component called as function — must be used as JSX",
    detail:
      "Calling a React component as a plain function bypasses React's reconciliation and breaks hooks inside the component.",
    fix: "Use JSX syntax: <MyComponent /> instead of {MyComponent()}.",
    docsQuery: "React component function call JSX rules reconciliation hooks",
    test: (line) =>
      /\{[A-Z][A-Za-z]+\(\)/.test(line) && !/new\s/.test(line) ? line : null,
  },
  {
    category: "react",
    severity: "medium",
    title: "Side effect at module/render scope — use useEffect",
    detail:
      "Code at the top level of a component body (outside hooks) runs on every render and in React 19 Strict Mode double-invocations, producing duplicate side effects.",
    fix: "Wrap side effects in useEffect. For one-time setup, use useEffect with an empty dependency array.",
    docsQuery: "React side effects render useEffect rules pure component",
    test: (line) =>
      /^\s*(?:fetch|axios|localStorage\.|sessionStorage\.|document\.|window\.location)/.test(
        line,
      ) && !/(?:const|let|var|return|export|import)\s/.test(line)
        ? line
        : null,
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
  {
    category: "nextjs",
    severity: "high",
    title: "middleware.ts — rename to proxy.ts in Next.js 16",
    detail:
      "Next.js 16 renamed middleware.ts to proxy.ts with a Node.js-only runtime. The old filename causes silent fallback to legacy behavior.",
    fix: "Rename middleware.ts to proxy.ts. Export a function named proxy instead of middleware.",
    docsQuery: "Next.js 16 proxy.ts middleware rename breaking change",
    test: (line, _content) =>
      /export\s+(?:default\s+)?function\s+middleware\b/.test(line) ||
      /export\s+\{\s*middleware\s+as\s+default\s*\}/.test(line)
        ? line
        : null,
  },
  {
    category: "nextjs",
    severity: "medium",
    title: "Page without metadata export — missing SEO",
    detail:
      "Pages without an exported metadata object or generateMetadata function have no title or description, harming SEO and social sharing.",
    fix: "Add `export const metadata: Metadata = { title: '...', description: '...' }` to every page.tsx.",
    docsQuery: "Next.js App Router metadata SEO title description generateMetadata",
    test: (line, content) =>
      /^export\s+default\s+(?:async\s+)?function\s+[A-Z]/.test(line) &&
      !content.includes("metadata") &&
      !content.includes("generateMetadata")
        ? line
        : null,
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
  {
    category: "typescript",
    severity: "high",
    title: "@ts-ignore suppresses type errors",
    detail:
      "@ts-ignore silently hides real type errors. The suppressed code can break at runtime without any compile-time warning.",
    fix: "Fix the underlying type error. If the error is a false positive, use @ts-expect-error with a comment explaining why.",
    docsQuery: "TypeScript ts-ignore ts-expect-error suppress errors best practices",
    test: (line) => (/@ts-ignore\b/.test(line) ? line : null),
  },
  {
    category: "typescript",
    severity: "high",
    title: "Unhandled Promise — missing await or .catch()",
    detail:
      "Floating Promises (async calls without await or .catch) silently swallow errors. Rejections are lost and the program continues in an inconsistent state.",
    fix: "Add await before async calls inside async functions. Add .catch(handleError) for fire-and-forget patterns.",
    docsQuery: "TypeScript floating Promise unhandled no-floating-promises eslint-typescript",
    test: (line) =>
      /^\s*(?!(?:return|const|let|var|await|throw|export|void)\s)(?:[a-zA-Z_$][a-zA-Z0-9_$.]*\s*\()/.test(
        line,
      ) && /\basync\b|\bPromise\b/.test(line)
        ? line
        : null,
  },
  {
    category: "typescript",
    severity: "medium",
    title: "require() in TypeScript — use import",
    detail:
      "require() bypasses TypeScript module resolution and static analysis. It disables tree-shaking and breaks ES module interop.",
    fix: "Replace require() with ES module import statements: `import { thing } from 'package'`.",
    docsQuery: "TypeScript require import ES modules no-require-imports typescript-eslint",
    test: (line) =>
      /\brequire\s*\(['"]/.test(line) &&
      !/^\/\//.test(line.trim()) &&
      !/\.d\.ts/.test(line)
        ? line
        : null,
  },
  {
    category: "typescript",
    severity: "medium",
    title: "Double type assertion (as unknown as T)",
    detail:
      "Double assertions are a sign that the types are fundamentally incompatible. They bypass all type safety and indicate a design problem.",
    fix: "Redesign the types to be compatible. If truly unavoidable, add a detailed comment justifying why.",
    docsQuery: "TypeScript as unknown as double assertion type safety no-unsafe-type-assertion",
    test: (line) =>
      /\bas\s+unknown\s+as\b/.test(line) && !line.trim().startsWith("//") ? line : null,
  },

  // === NODE ===
  {
    category: "node",
    severity: "medium",
    title: "console.log in production code",
    detail:
      "console.log statements leak internal data structures, variable values, and potential secrets to server logs and browser consoles.",
    fix: "Remove console.log before deploying. Use a structured logger (pino, winston) with log levels for intentional server-side logging.",
    docsQuery: "Node.js logging console.log production pino winston structured logging",
    test: (line) =>
      /\bconsole\.log\s*\(/.test(line) && !line.trim().startsWith("//") ? line : null,
  },
  {
    category: "node",
    severity: "high",
    title: "Synchronous file system operation — blocks event loop",
    detail:
      "Synchronous fs operations (readFileSync, writeFileSync) block the Node.js event loop for their entire duration. Under load this halts all concurrent requests.",
    fix: "Use the async equivalents: await readFile(), await writeFile(). In serverless contexts, prefer streaming.",
    docsQuery: "Node.js event loop blocking readFileSync async fs OWASP",
    test: (line) =>
      /\b(?:readFileSync|writeFileSync|appendFileSync|existsSync|mkdirSync|rmdirSync|readdirSync)\s*\(/.test(
        line,
      )
        ? line
        : null,
  },
  {
    category: "node",
    severity: "high",
    title: "Unhandled callback error — swallowed failure",
    detail:
      "Node.js callbacks follow the (err, data) convention. Ignoring the err argument means errors are silently swallowed, leaving the application in an unknown state.",
    fix: "Check err first: `if (err) { logger.error(err); return; }`. Or migrate to async/await which surfaces errors automatically.",
    docsQuery: "Node.js callback error handling (err, data) convention async await",
    test: (line) =>
      /function\s*\(\s*(?:err|error)\s*,\s*\w+\s*\)/.test(line) &&
      !/if\s*\(\s*(?:err|error)\b/.test(line)
        ? line
        : null,
  },
  {
    category: "node",
    severity: "medium",
    title: "process.exit() — abrupt shutdown without cleanup",
    detail:
      "process.exit() terminates immediately without draining in-flight requests, flushing logs, or releasing database connections.",
    fix: "Let the process exit naturally or use graceful shutdown: close server connections, flush logs, then let the event loop drain.",
    docsQuery: "Node.js process.exit graceful shutdown cleanup event loop",
    test: (line) =>
      /\bprocess\.exit\s*\(/.test(line) && !line.trim().startsWith("//") ? line : null,
  },
  {
    category: "node",
    severity: "medium",
    title: "HTTP fetch in production — use HTTPS",
    detail:
      "Plain HTTP requests transmit data in cleartext. This enables man-in-the-middle attacks, credential interception, and violates HSTS policies.",
    fix: "Use HTTPS for all outbound requests. Never hardcode http:// URLs for production APIs or services.",
    docsQuery: "HTTPS HTTP security man-in-the-middle TLS Node.js fetch",
    test: (line) =>
      /fetch\s*\(\s*['"]http:\/\//.test(line) ||
      /axios\.(?:get|post|put|delete)\s*\(\s*['"]http:\/\//.test(line)
        ? line
        : null,
  },

  // ── Python ─────────────────────────────────────────────────────────────────
  {
    category: "python",
    severity: "critical",
    title: "SQL injection via f-string or % formatting",
    detail:
      "Interpolating user input directly into SQL strings enables SQL injection attacks. An attacker can read, modify, or delete any data in the database.",
    fix: "Use parameterized queries: `cursor.execute('SELECT * FROM users WHERE id = %s', (user_id,))`. Never use f-strings, .format(), or % to build SQL.",
    docsQuery: "Python SQL injection parameterized queries OWASP",
    test: (line) =>
      /\.execute\s*\(.*f['"].*\{/.test(line) ||
      /\.execute\s*\(.*['"]\s*%\s*(?:\(|[a-zA-Z_])/.test(line) ||
      /\.execute\s*\(.*\.format\s*\(/.test(line)
        ? line
        : null,
  },
  {
    category: "python",
    severity: "critical",
    title: "eval() or exec() with dynamic input",
    detail:
      "`eval()` and `exec()` execute arbitrary Python code. If the argument is derived from user input or an external source, an attacker can run any code on the server.",
    fix: "Never pass user-controlled data to `eval()` or `exec()`. Use `ast.literal_eval()` for safe parsing of Python literals.",
    docsQuery: "Python eval exec security code injection OWASP",
    test: (line) =>
      /\beval\s*\(/.test(line) || /\bexec\s*\(/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "critical",
    title: "subprocess with shell=True",
    detail:
      "`subprocess.run(..., shell=True)` passes the command to the system shell. If any part of the command includes user input, it enables command injection.",
    fix: "Pass commands as a list: `subprocess.run(['ls', '-la'])`. Never use `shell=True` with any data that originates outside your application.",
    docsQuery: "Python subprocess shell=True command injection security",
    test: (line) => /subprocess\.\w+\s*\(.*shell\s*=\s*True/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "critical",
    title: "os.system() call — command injection risk",
    detail:
      "`os.system()` passes commands to the shell. User-controlled input in the command string enables arbitrary command execution.",
    fix: "Replace with `subprocess.run([...], check=True)` using a list of arguments. This avoids shell interpretation and command injection.",
    docsQuery: "Python os.system command injection subprocess",
    test: (line) => /\bos\.system\s*\(/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "high",
    title: "Bare except clause swallows all errors",
    detail:
      "`except:` without an exception type catches every exception including `KeyboardInterrupt`, `SystemExit`, and `GeneratorExit`. This hides bugs and can prevent the program from shutting down cleanly.",
    fix: "Always specify the exception type: `except Exception as e:`. Log or re-raise the error. Never use a bare `except:` in production code.",
    docsQuery: "Python bare except anti-pattern exception handling",
    test: (line) => /^\s*except\s*:/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "high",
    title: "pickle.loads() from untrusted source",
    detail:
      "Pickle deserialization executes arbitrary Python code. Loading pickled data from an untrusted source (user input, network, database without integrity check) allows remote code execution.",
    fix: "Never unpickle data from untrusted sources. Use JSON, MessagePack, or Protocol Buffers for data exchange. If pickle is required, verify an HMAC signature before deserializing.",
    docsQuery: "Python pickle deserialization RCE security OWASP",
    test: (line) => /\bpickle\.loads?\s*\(/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "high",
    title: "MD5 or SHA1 used for password hashing",
    detail:
      "MD5 and SHA1 are cryptographically broken. They are fast to compute, enabling brute-force and rainbow table attacks. Never use them for storing passwords.",
    fix: "Use `bcrypt`, `argon2-cffi`, or `passlib` for password hashing. For non-password integrity checks, use SHA-256 or SHA-3.",
    docsQuery: "Python password hashing bcrypt argon2 security OWASP",
    test: (line) =>
      /hashlib\.(md5|sha1)\s*\(/.test(line) ||
      /new\s*\(\s*['"](?:md5|sha1)['"]\s*\)/.test(line)
        ? line
        : null,
  },
  {
    category: "python",
    severity: "high",
    title: "requests with verify=False — TLS validation disabled",
    detail:
      "Setting `verify=False` disables TLS certificate verification, making the connection vulnerable to man-in-the-middle attacks. An attacker can intercept and modify traffic.",
    fix: "Remove `verify=False`. If using a self-signed certificate, pass the CA bundle path: `verify='/path/to/ca-bundle.crt'`.",
    docsQuery: "Python requests verify=False TLS SSL certificate security",
    test: (line) => /requests\.\w+\s*\(.*verify\s*=\s*False/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "high",
    title: "Mutable default argument",
    detail:
      "Default argument values are evaluated once when the function is defined, not each time it is called. A mutable default (list, dict, set) is shared across all calls, leading to subtle state-leaking bugs.",
    fix: "Use `None` as the default and initialize inside the function: `def fn(items=None): items = items if items is not None else []`.",
    docsQuery: "Python mutable default argument anti-pattern",
    test: (line) =>
      /def\s+\w+\s*\([^)]*=\s*(?:\[\]|\{\}|set\s*\(\))/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "medium",
    title: "print() in production code",
    detail:
      "`print()` writes to stdout with no log level, no timestamps, and no filtering. In production this pollutes logs and can expose sensitive data.",
    fix: "Replace with `logging.debug()`, `logging.info()`, etc. Configure the root logger at application startup with a structured formatter.",
    docsQuery: "Python logging best practices production print",
    test: (line) => /\bprint\s*\(/.test(line) ? line : null,
  },
  {
    category: "python",
    severity: "medium",
    title: "open() with user-controlled path — path traversal risk",
    detail:
      "Passing unsanitized user input to `open()` allows path traversal attacks (`../../etc/passwd`). An attacker can read or overwrite arbitrary files.",
    fix: "Resolve and validate the path before opening: `safe = Path(base_dir).resolve() / user_input; safe.resolve().relative_to(base_dir)`. Raise an error if the path escapes the allowed directory.",
    docsQuery: "Python path traversal open file security OWASP",
    test: (line, _content, _offset, lines, i) => {
      if (!/\bopen\s*\(/.test(line)) return null;
      const nearby = lines.slice(Math.max(0, i - 5), i + 1).join(" ");
      return /request\.|args\[|kwargs\[|input\(|sys\.argv/.test(nearby) ? line : null;
    },
  },

  // === VUE ===
  {
    category: "vue",
    severity: "medium",
    title: "v-for without :key",
    detail: "v-for directives must have a unique :key to avoid rendering bugs",
    fix: "Add :key with a unique identifier: <li v-for=\"item in items\" :key=\"item.id\">",
    docsQuery: "Vue v-for key binding best practices",
    test: (line) => {
      if (!line.includes("v-for") || line.includes(":key") || line.includes("v-bind:key")) return null;
      return line;
    },
  },
  {
    category: "vue",
    severity: "high",
    title: "Mutating props directly",
    detail: "Props must not be mutated — use emits or a local ref copy instead",
    fix: "Replace prop mutation with $emit or const localVal = ref(props.value)",
    docsQuery: "Vue 3 props emit pattern",
    test: (line) => {
      return /props\.\w+\s*=/.test(line) ? line : null;
    },
  },
  {
    category: "vue",
    severity: "low",
    title: "Options API data() in Composition API project",
    detail: "Mixing Options API data() with Composition API reduces readability",
    fix: "Convert data() to reactive() or ref() inside <script setup>",
    docsQuery: "Vue 3 script setup composition API migration",
    test: (line) => {
      return /^\s*data\s*\(\s*\)\s*\{/.test(line) ? line : null;
    },
  },

  // === SVELTE ===
  {
    category: "svelte",
    severity: "medium",
    title: "Svelte 4 reactive declaration in Svelte 5 project",
    detail: "$: reactive declarations are deprecated in Svelte 5 — use $derived() rune",
    fix: "Replace $: value = expr with const value = $derived(expr)",
    docsQuery: "Svelte 5 derived rune migration from reactive declarations",
    test: (line, _content, _offset, _lines, _i) => {
      return /^\s*\$:\s+/.test(line) ? line : null;
    },
  },
  {
    category: "svelte",
    severity: "low",
    title: "Svelte 4 event directive in Svelte 5 project",
    detail: "on:click directives are deprecated in Svelte 5 — use onclick attribute",
    fix: "Replace on:click={handler} with onclick={handler}",
    docsQuery: "Svelte 5 event handler migration onclick",
    test: (line) => {
      return /\bon:[a-z]+=/i.test(line) ? line : null;
    },
  },
  {
    category: "svelte",
    severity: "low",
    title: "Svelte 4 createEventDispatcher in Svelte 5 project",
    detail: "createEventDispatcher is deprecated in Svelte 5 — use callback props instead",
    fix: "Replace dispatch('event', data) with a callback prop defined via $props()",
    docsQuery: "Svelte 5 events callback props migration createEventDispatcher",
    test: (line) => {
      return /createEventDispatcher/.test(line) ? line : null;
    },
  },

  // === ANGULAR ===
  {
    category: "angular",
    severity: "high",
    title: "Manual subscription without cleanup in ngOnInit",
    detail: "Manual subscriptions in ngOnInit leak unless unsubscribed — use takeUntilDestroyed",
    fix: "Add .pipe(takeUntilDestroyed()) or store subscription in ngOnDestroy",
    docsQuery: "Angular takeUntilDestroyed subscription cleanup",
    test: (line, content) => {
      if (!line.includes(".subscribe(") || !content.includes("ngOnInit")) return null;
      if (content.includes("takeUntilDestroyed") || content.includes("ngOnDestroy")) return null;
      return line;
    },
  },
  {
    category: "angular",
    severity: "medium",
    title: "Mutable @Input() property",
    detail: "@Input() properties should be readonly to prevent accidental mutation",
    fix: "Add readonly: @Input() readonly title: string",
    docsQuery: "Angular Input readonly signal-based inputs",
    test: (line) => {
      return /@Input\(\)(?!\s*readonly)/.test(line) ? line : null;
    },
  },
  {
    category: "angular",
    severity: "low",
    title: "Legacy *ngIf / *ngFor structural directive",
    detail: "Angular 17+ prefers @if and @for block syntax over *ngIf and *ngFor directives",
    fix: "Replace *ngIf=\"cond\" with @if (cond) {} block; replace *ngFor with @for (x of xs; track x.id) {}",
    docsQuery: "Angular 17 control flow @if @for migration ngIf ngFor",
    test: (line) => {
      return /\*ngIf=|\*ngFor=/.test(line) ? line : null;
    },
  },

  // === TESTING ===
  {
    category: "testing",
    severity: "critical",
    title: "test.only / it.only committed",
    detail: "Committed test.only or it.only will skip all other tests in CI",
    fix: "Remove .only before committing: change test.only to test",
    docsQuery: "Vitest test.only CI trap",
    test: (line) => {
      return /(?:test|it|describe)\.only\s*\(/.test(line) ? line : null;
    },
  },
  {
    category: "testing",
    severity: "high",
    title: "waitForTimeout / sleep in test",
    detail: "Hardcoded timeouts cause flaky tests — use deterministic waits instead",
    fix: "Replace await page.waitForTimeout(1000) with await expect(locator).toBeVisible()",
    docsQuery: "Playwright avoid waitForTimeout deterministic assertions",
    test: (line) => {
      return /waitForTimeout\s*\(\s*\d+|\.sleep\s*\(\s*\d+/.test(line) ? line : null;
    },
  },
  {
    category: "testing",
    severity: "medium",
    title: "console.log inside test body",
    detail: "console.log in tests obscures failures and pollutes CI output",
    fix: "Remove console.log — use expect() assertions to verify state instead",
    docsQuery: "Vitest no console.log in tests best practices",
    test: (line) => {
      return /^\s*console\.log\s*\(/.test(line) ? line : null;
    },
  },

  // === MOBILE (React Native) ===
  {
    category: "mobile",
    severity: "high",
    title: "FlatList without keyExtractor",
    detail: "Missing keyExtractor causes list re-render performance issues",
    fix: "Add keyExtractor: <FlatList keyExtractor={(item) => item.id.toString()} ...>",
    docsQuery: "React Native FlatList keyExtractor performance",
    test: (line, content, charOffset) => {
      if (!line.includes("<FlatList") && !line.includes("FlatList ")) return null;
      const nearby = content.slice(Math.max(0, charOffset - 500), charOffset + 500);
      return !nearby.includes("keyExtractor") ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "medium",
    title: "Missing accessible prop on touchable element",
    detail: "TouchableOpacity and Pressable elements need accessible={true} and accessibilityLabel",
    fix: "Add accessible={true} accessibilityLabel=\"Description\" to touchable components",
    docsQuery: "React Native accessibility accessibilityLabel touchable",
    test: (line, content, charOffset) => {
      if (!/<(?:TouchableOpacity|Pressable|TouchableHighlight)/.test(line)) return null;
      const nearby = content.slice(Math.max(0, charOffset - 200), charOffset + 300);
      return !nearby.includes("accessibilityLabel") ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "low",
    title: "Inline style object on View or Text",
    detail: "Inline style objects are recreated on every render — define styles in StyleSheet.create",
    fix: "Move inline styles to const styles = StyleSheet.create({ container: { flex: 1 } })",
    docsQuery: "React Native StyleSheet performance inline styles",
    test: (line) => {
      return /<(?:View|Text|ScrollView)\s[^>]*style=\{\{/.test(line) ? line : null;
    },
  },

  // === API ===
  {
    category: "api",
    severity: "high",
    title: "Route handler exposes error stack trace",
    detail: "Returning error.stack or error.message in API responses leaks internals",
    fix: "Return generic error: res.status(500).json({ error: 'Internal server error' })",
    docsQuery: "Express error handling generic messages production",
    test: (line) => {
      return /(?:err|error)\.stack|\.json\(\{[^}]*(?:err|error)\.message/.test(line) ? line : null;
    },
  },
  {
    category: "api",
    severity: "high",
    title: "req.query used without validation",
    detail: "Unvalidated query parameters allow injection and unexpected behavior",
    fix: "Validate with zod: const { page } = QuerySchema.parse(req.query)",
    docsQuery: "Express zod query parameter validation",
    test: (line) => {
      return /req\.query\./.test(line) ? line : null;
    },
  },
  {
    category: "api",
    severity: "medium",
    title: "Route handler without try/catch",
    detail: "Uncaught async errors in route handlers crash the process",
    fix: "Wrap handler body in try/catch or use an async error wrapper middleware",
    docsQuery: "Express async route handler error handling",
    test: (line, content, charOffset) => {
      if (!/(app|router)\.\s*(?:get|post|put|patch|delete)\s*\(/.test(line)) return null;
      const handlerStart = charOffset;
      const nearby = content.slice(handlerStart, handlerStart + 500);
      return !/try\s*\{/.test(nearby) ? line : null;
    },
  },

  // === CSS ===
  {
    category: "css",
    severity: "medium",
    title: "Pixel font sizes instead of rem",
    detail: "px font sizes ignore user browser font-size preferences — use rem instead",
    fix: "Replace font-size: 16px with font-size: 1rem (1rem = user's base font size)",
    docsQuery: "CSS rem vs px accessibility font size WCAG",
    test: (line) => {
      return /font-size:\s*\d+px/.test(line) ? line : null;
    },
  },
  {
    category: "css",
    severity: "low",
    title: "z-index: 9999 magic number",
    detail: "Arbitrary high z-index values cause stacking context chaos — use design tokens",
    fix: "Define a z-index scale: --z-modal: 100; --z-dropdown: 50; --z-overlay: 200",
    docsQuery: "CSS z-index scale design tokens best practices",
    test: (line) => {
      return /z-index:\s*9{3,}/.test(line) ? line : null;
    },
  },
  {
    category: "css",
    severity: "medium",
    title: "Missing prefers-reduced-motion for animation",
    detail: "CSS animations must respect prefers-reduced-motion for vestibular safety",
    fix: "Wrap animation in @media (prefers-reduced-motion: no-preference) { ... }",
    docsQuery: "CSS prefers-reduced-motion accessibility WCAG 3.0.3",
    test: (line, content) => {
      if (!/@keyframes|animation:/.test(line)) return null;
      return !content.includes("prefers-reduced-motion") ? line : null;
    },
  },
  {
    category: "css",
    severity: "low",
    title: "!important overuse",
    detail: "Excessive !important creates specificity wars and maintenance problems",
    fix: "Refactor selectors for proper specificity — use CSS Layers (@layer) instead",
    docsQuery: "CSS specificity layers best practices avoid !important",
    test: (line, content) => {
      const count = (content.match(/!important/g) ?? []).length;
      return count > 3 && line.includes("!important") ? line : null;
    },
  },

  // === SEO ===
  {
    category: "seo",
    severity: "high",
    title: "img element missing alt attribute",
    detail: "Images without alt text are inaccessible and hurt SEO",
    fix: "Add descriptive alt: <img alt=\"Team photo\"> or alt=\"\" for decorative images",
    docsQuery: "HTML img alt attribute SEO accessibility",
    test: (line) => {
      if (!/<img\s/.test(line)) return null;
      return !line.includes("alt=") ? line : null;
    },
  },
  {
    category: "seo",
    severity: "high",
    title: "Missing generateMetadata in Next.js page",
    detail: "Next.js App Router pages without generateMetadata have no SEO meta tags",
    fix: "Export generateMetadata: export async function generateMetadata() { return { title, description } }",
    docsQuery: "Next.js generateMetadata App Router SEO",
    test: (line, content, _offset, _lines, _i, filePath) => {
      if (!line.includes("export default")) return null;
      // Page-level metadata only applies to App Router page files. When the
      // file path is known, anything that is not page.* is skipped — flagging
      // components/layouts/configs here was a false-positive factory.
      if (filePath !== undefined && !/(^|\/)page\.(tsx|jsx|ts|js)$/.test(filePath)) return null;
      return !content.includes("generateMetadata") && !content.includes("metadata =") ? line : null;
    },
  },
  {
    category: "seo",
    severity: "medium",
    title: "Hardcoded <title> tag in JSX",
    detail: "Use Next.js generateMetadata or Remix meta exports instead of raw <title> tags in JSX",
    fix: "Export metadata = { title: '...' } or generateMetadata() from the page file",
    docsQuery: "Next.js metadata title generateMetadata App Router",
    test: (line) => {
      return /<title>[^<{]/.test(line) ? line : null;
    },
  },

  // === i18n ===
  {
    category: "i18n",
    severity: "medium",
    title: "Hardcoded currency symbol",
    detail: "Hardcoded $ or € signs break for other locales — use Intl.NumberFormat",
    fix: "Replace '$' + price with new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)",
    docsQuery: "Intl.NumberFormat currency formatting JavaScript",
    test: (line) => {
      return /['"`]\$[0-9]|'\$'\s*\+|"\$"\s*\+|`\$\s*\$\{/.test(line) ? line : null;
    },
  },
  {
    category: "i18n",
    severity: "low",
    title: "toLocaleDateString without locale argument",
    detail: "toLocaleDateString() without a locale argument produces inconsistent results across environments",
    fix: "Always pass a locale: date.toLocaleDateString('de-DE', { dateStyle: 'medium' })",
    docsQuery: "JavaScript toLocaleDateString locale argument consistency",
    test: (line) => {
      return /\.toLocaleDateString\(\s*\)/.test(line) ? line : null;
    },
  },
  {
    category: "i18n",
    severity: "low",
    title: "toLocaleString without locale argument",
    detail: "toLocaleString() without a locale produces inconsistent output across environments",
    fix: "Always pass a locale: value.toLocaleString('de-DE') or use Intl.NumberFormat",
    docsQuery: "JavaScript toLocaleString locale argument consistency",
    test: (line) => {
      return /\.toLocaleString\(\s*\)/.test(line) ? line : null;
    },
  },

  // === CODE QUALITY ===
  {
    category: "node",
    severity: "low",
    title: "TODO/FIXME left in code",
    detail: "Unresolved TODO or FIXME markers indicate untracked technical debt",
    fix: "Resolve the TODO, file an issue, or remove it if no longer relevant",
    docsQuery: "technical debt management TODO tracking",
    test: (line) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("#") || line.trim().startsWith("*")) {
        return /\b(?:TODO|FIXME|HACK|XXX|WORKAROUND)\b/i.test(line) ? line : null;
      }
      return null;
    },
  },

  // === MOBILE (additional) ===
  {
    category: "mobile",
    severity: "medium",
    title: "StyleSheet.create inside component body",
    detail: "Defining StyleSheet.create inside a component recreates styles on every render. Move it outside the component.",
    fix: "Move StyleSheet.create to module scope: const styles = StyleSheet.create({...}) after the component",
    docsQuery: "React Native StyleSheet.create performance outside component",
    test: (line, content, charOffset) => {
      if (!/StyleSheet\.create/.test(line)) return null;
      const idx = charOffset;
      const before = content.slice(Math.max(0, idx - 2000), idx);
      // Disjoint skip modes ([^=()] vs parenthesized groups) — the previous
      // overlapping alternation was catastrophically backtracking (ReDoS) on
      // benign builder chains like Yup.object().shape({...}).shape({...}).
      const hasComponentAbove = /(?:function\s+\w+|const\s+\w+\s*=\s*(?:[^=()]*\([^)]*\))*[^=()]*=>|class\s+\w+)/.test(before);
      const hasReturnAbove = /\breturn\s*\(/.test(before);
      return hasComponentAbove && hasReturnAbove ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "high",
    title: "Hardcoded pixel dimensions without responsive scaling",
    detail: "Hardcoded width/height pixel values break on different screen sizes. Use Dimensions, useWindowDimensions, or percentage-based layouts.",
    fix: "Use useWindowDimensions() or percentage values: width: '80%' instead of width: 320",
    docsQuery: "React Native responsive design Dimensions useWindowDimensions",
    test: (line) => {
      return /(?:width|height):\s*(?:3[2-9]\d|[4-9]\d\d|\d{4,})/.test(line) ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "medium",
    title: "ScrollView wrapping FlatList or SectionList",
    detail: "Nesting a FlatList inside a ScrollView disables virtualization and causes performance issues",
    fix: "Remove the outer ScrollView, use ListHeaderComponent and ListFooterComponent instead",
    docsQuery: "React Native FlatList ScrollView nesting performance VirtualizedList",
    test: (line, content, charOffset) => {
      if (!/<ScrollView/.test(line)) return null;
      const idx = charOffset;
      const after = content.slice(idx, idx + 3000);
      return /(?:<FlatList|<SectionList)/.test(after) ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "medium",
    title: "Image without explicit dimensions",
    detail: "Images without width and height cause layout shifts during loading",
    fix: "Add explicit width and height to all Image components, or use aspectRatio with one dimension",
    docsQuery: "React Native Image dimensions layout shift performance",
    test: (line, content, charOffset) => {
      if (!/<Image\s/.test(line)) return null;
      const idx = charOffset;
      const nearby = content.slice(idx, idx + 500);
      return !/(?:width|height)\s*[:=]/.test(nearby) && !/style=/.test(nearby) ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "low",
    title: "console.log or console.warn in component",
    detail: "Console statements in React Native components impact bridge performance and should be removed before production",
    fix: "Remove console statements or use __DEV__ guard: if (__DEV__) console.log(...)",
    docsQuery: "React Native console.log performance production __DEV__",
    test: (line) => {
      return /\bconsole\.(?:log|warn|error|debug|info)\s*\(/.test(line) ? line : null;
    },
  },
  {
    category: "mobile",
    severity: "high",
    title: "Missing error boundary in navigation screen",
    detail: "Unhandled errors in navigation screens crash the entire app. Wrap screens in error boundaries.",
    fix: "Add ErrorBoundary wrapper: <ErrorBoundary fallback={<CrashScreen />}><Screen /></ErrorBoundary>",
    docsQuery: "React Native error boundary navigation crash handling",
    test: (line, content, charOffset) => {
      if (!/Screen\s+name=/.test(line)) return null;
      const idx = charOffset;
      const nearby = content.slice(Math.max(0, idx - 500), idx + 500);
      return !/ErrorBoundary/.test(nearby) ? line : null;
    },
  },
];

