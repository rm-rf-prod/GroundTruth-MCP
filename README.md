<p align="center">
  <img src="./banner.webp" alt="ws-mcp" width="100%" />
</p>

<h1 align="center">ws-mcp</h1>

<p align="center">
  Self-hosted MCP server for live documentation and deep code audits.<br/>
  No rate limits. No API keys. No cloud dependency. 330+ libraries.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@senorit/ws-mcp"><img src="https://img.shields.io/npm/v/@senorit/ws-mcp?color=00d4aa&label=npm" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-ELv2-orange" alt="Elastic License 2.0" /></a>
  <img src="https://img.shields.io/badge/libraries-330%2B-teal" alt="330+ libraries" />
  <img src="https://img.shields.io/badge/audit_patterns-50%2B-red" alt="50+ audit patterns" />
  <img src="https://img.shields.io/badge/categories-8-blue" alt="8 categories" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node 20+" />
</p>

---

## Install

### Claude Code

```bash
claude mcp add ws -- npx -y @senorit/ws-mcp@latest
```

### Cursor / Claude Desktop / VS Code

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, or `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "ws": {
      "command": "npx",
      "args": ["-y", "@senorit/ws-mcp@latest"]
    }
  }
}
```

No build step. No configuration. Node.js 20+ only.

---

## Tools

ws-mcp provides six tools that fetch current, authoritative documentation at query time — not from training data.

| Tool | What it does |
|---|---|
| `ws_resolve_library` | Resolves a library name to its registry entry and docs URL |
| `ws_get_docs` | Fetches current documentation for a specific topic within a library |
| `ws_best_practices` | Fetches patterns, anti-patterns, and configuration guidance |
| `ws_auto_scan` | Reads package.json / requirements.txt and fetches best practices per dependency |
| `ws_search` | Freeform search across OWASP, MDN, web.dev, W3C, WCAG, and more |
| `ws_audit` | Scans source files for real issues with file:line locations and live fix references |

---

## `ws_audit` — code audit tool

`ws_audit` performs static analysis across your entire project, reports exact file and line locations, and fetches live fix guidance from official sources for each issue type it finds.

### How it works

1. **Walks the project tree** — reads all `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html` source files up to a configurable limit (default: 50 files, max: 200)
2. **Skips noise** — automatically skips test files (`.test.`, `.spec.`, `.d.ts`, `__tests__/`, `.stories.`), generated files, and commented-out lines
3. **Runs 50+ patterns** — each pattern targets one specific issue class, sourced from OWASP cheat sheets, typescript-eslint rules, react.dev/reference/rules, and web.dev
4. **Fetches live fixes** — for the top unique issue types, fetches current guidance from the authoritative source for that category
5. **Reports with context** — each finding includes the exact file path, line number, problem description, and a concrete fix

### Categories

```
ws_audit({ categories: ["all"] })                   // default — all 8 categories
ws_audit({ categories: ["security", "node"] })      // OWASP issues + Node.js anti-patterns
ws_audit({ categories: ["accessibility"] })         // WCAG AA compliance scan
ws_audit({ categories: ["typescript", "react"] })   // type safety + React best practices
```

| Category | Patterns | What it checks |
|---|---|---|
| `layout` | 6 | CLS-causing images, raw `<img>` vs next/image, 100vh on mobile, missing font-display, render-blocking scripts, CSS `@import` chains |
| `performance` | 7 | Missing lazy loading, useEffect data fetching, barrel file tree-shaking, missing Suspense boundaries, `document.querySelector` in React, inline object/array props, missing fetchpriority on LCP image |
| `accessibility` | 10 | Missing alt text (WCAG 1.1.1), onClick on div/span (WCAG 2.1.1), icon-only buttons without aria-label, inputs without labels, `outline: none` removal, positive tabIndex, `role="button"` on non-buttons, placeholder href links, missing lang attribute, prefers-reduced-motion |
| `security` | 11 | XSS via innerHTML, SQL injection via template literals, command injection in child_process, SSRF via user-controlled URLs, path traversal in fs calls, NEXT_PUBLIC_ secret exposure, hardcoded credentials, unvalidated Server Actions, implied eval, CORS wildcard, dynamic code execution |
| `react` | 7 | forwardRef deprecated (React 19), useFormState renamed to useActionState, array index as key, missing event listener cleanup, conditional hook calls (Rules of Hooks), component called as function, side effects at render scope |
| `nextjs` | 6 | Sync cookies()/headers()/params without await (Next.js 16), `use client` on layout, Tailwind v3 directives, Route Handler without error handling, middleware.ts not renamed to proxy.ts, pages without metadata |
| `typescript` | 7 | `any` type, non-null assertions, missing return types, `@ts-ignore`, floating Promises, `require()` instead of import, double assertion (`as unknown as T`) |
| `node` | 5 | `console.log` in production, synchronous fs operations (event loop blocking), unhandled callback errors, `process.exit()` without cleanup, plain HTTP fetch |

### Options

```typescript
ws_audit({
  projectPath: "./src",           // defaults to cwd
  categories: ["security"],       // or "all" (default)
  maxFiles: 100,                  // 1-200, default 50
  tokens: 6000,                   // max tokens per docs fetch, default 4000
})
```

### Example output

```
# Code Audit Report
> Path: /projects/my-app
> Files scanned: 47 | Issues: 23 | Unique types: 9
> Categories: all

---

## [CRITICAL] SQL built via template literal — SQL injection risk
**Category:** security | **Severity:** critical | **Count:** 2

**Problem:** Building SQL queries with template literals allows attackers to inject
arbitrary SQL when user input reaches the string.

**Fix:** Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [userId]).
Never interpolate user input into SQL strings.

**Files:**
  - `src/db/users.ts:47`
  - `src/api/search.ts:23`

**Live best practice (official docs):**
[content fetched from OWASP SQL Injection Prevention Cheat Sheet]

---

## [HIGH] Sync cookies() — must await in Next.js 16
**Category:** nextjs | **Severity:** high | **Count:** 4

**Problem:** cookies(), headers(), and draftMode() are async in Next.js 16.
Calling them without await throws a runtime error.

**Fix:** Add await before every call: const cookieStore = await cookies()

**Files:**
  - `app/dashboard/page.tsx:12`
  - `app/api/auth/route.ts:8`
  ...
```

---

## `ws_search` — freeform search

Finds documentation for any topic without an npm package: web standards, security specs, browser APIs, accessibility guidelines.

```
ws_search({ query: "WCAG 2.2 focus indicators" })
ws_search({ query: "JWT vs session cookies security 2025" })
ws_search({ query: "Core Web Vitals LCP optimization" })
ws_search({ query: "CSS container queries browser support" })
ws_search({ query: "OWASP Node.js security cheat sheet" })
```

Sources: OWASP, MDN, web.dev, W3C, WCAG, Node.js docs, and more.

---

## `ws_auto_scan` — dependency best practices

Reads your project's dependency manifest and fetches best practices for each dependency automatically.

```
ws_auto_scan({ projectPath: "." })
```

Supports: `package.json` (Node.js / npm), `requirements.txt` (Python), `Cargo.toml` (Rust), `go.mod` (Go), `pom.xml` (Java / Maven).

---

## Usage

### Natural language (recommended)

```
use ws for nextjs
use ws for drizzle migrations
ws audit
use ws to check WCAG focus indicators
use ws for security
find all issues and fix with ws
```

### Direct tool calls

```typescript
ws_resolve_library({ libraryName: "drizzle" })
ws_get_docs({ libraryId: "drizzle-team/drizzle-orm", topic: "migrations" })
ws_best_practices({ libraryId: "vercel/next.js", topic: "caching" })
ws_auto_scan({ projectPath: "." })
ws_search({ query: "OWASP SQL injection prevention 2025" })
ws_audit({ projectPath: ".", categories: ["security", "accessibility"] })
```

---

## Fetch chain

For every library docs request, ws-mcp tries in order:

1. **`llms.txt` / `llms-full.txt`** — purpose-built LLM context files published by the project maintainer. Authoritative and concise.
2. **Jina Reader** (`r.jina.ai`) — converts the official docs page to clean markdown, handles JavaScript-rendered sites
3. **GitHub README / releases** — latest release notes and README from the project's GitHub repository
4. **npm / PyPI metadata** — fallback for packages not in the curated registry

The curated registry covers 330+ libraries with pre-mapped llms.txt URLs for instant resolution. For anything outside the registry, ws-mcp falls back to npm/PyPI metadata.

---

## vs. Context7

| | ws-mcp | Context7 |
|---|---|---|
| Hosting | Your machine | Cloud service |
| Rate limits | None | Yes (shared infrastructure) |
| Source priority | llms.txt → Jina → GitHub | Embeddings of doc pages |
| Code audit tool | Yes — 50+ patterns, file:line, live fixes | No |
| Freeform search | Yes — OWASP, MDN, web standards | Library docs only |
| Libraries | 230+ curated + npm/PyPI fallback | ~130 |
| Python / Rust / Go | Yes | Limited |
| API key required | No | No |
| Audit categories | 8 (layout, perf, a11y, security, react, nextjs, ts, node) | N/A |

---

## Auto-updates

Uses `npx -y @senorit/ws-mcp@latest`. On every session start, npx checks npm for the latest version and downloads it automatically.

---

## Requirements

- Node.js 20+
- Claude Code, Cursor, VS Code (with MCP extension), or Claude Desktop

---

## Contributing

The library registry lives in `src/sources/registry.ts`. To add a library, open a PR with the entry: `id`, `name`, `docsUrl`, and `llmsTxtUrl` if the project publishes one.

Bug reports and feature requests: [GitHub Issues](https://github.com/rm-rf-prod/ws-mcp/issues)

---

## License

[Elastic License 2.0](./LICENSE) — free to use and self-host. You may not offer it as a managed service or build a competing product from it.
