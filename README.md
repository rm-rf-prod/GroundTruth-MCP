<p align="center">
  <img src="./banner.webp" alt="ws-mcp — self-hosted MCP server for live documentation and code audits" width="100%" />
</p>

<h1 align="center">ws-mcp</h1>

<p align="center">
  Self-hosted MCP server that fetches live documentation, runs code audits,<br/>
  and searches authoritative references at query time. Not training data.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@senorit/ws-mcp"><img src="https://img.shields.io/npm/v/@senorit/ws-mcp?color=00d4aa&label=npm" alt="npm version" /></a>
  <a href="https://github.com/rm-rf-prod/ws-mcp/actions/workflows/ci.yml"><img src="https://github.com/rm-rf-prod/ws-mcp/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-ELv2-orange" alt="Elastic License 2.0" /></a>
  <img src="https://img.shields.io/badge/libraries-330%2B-teal" alt="330+ libraries" />
  <img src="https://img.shields.io/badge/audit_patterns-60%2B-red" alt="60+ audit patterns" />
  <img src="https://img.shields.io/badge/tests-192-brightgreen" alt="192 tests" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-green" alt="Node 24+" />
</p>

---

## Why this exists

AI coding assistants hallucinate APIs. Not because the models are bad, but because documentation changes faster than training data does. A library ships a major version, deprecates half its API, and the model keeps generating the old patterns for months. You catch it in review if you're lucky. You catch it in production if you're not.

Context7 helps, but it has rate limits, lives in the cloud, and covers around 130 libraries. Hit the quota mid-session and you get nothing. I did this enough times that I built the thing I actually wanted.

ws-mcp runs on your machine. It fetches docs directly from the source at query time: `llms.txt` files first (purpose-built for LLMs by the maintainers themselves), then Jina Reader for JS-rendered pages, then GitHub. No quota, no cold start, no cache from six months ago. Coverage is 330+ libraries across the Python AI/ML stack, Go, Rust, and web standards including OWASP, MDN, and WebAssembly.

The audit tool came from a different problem. AI assistants produce insecure code patterns without knowing they're doing it. SQL built with template literals, `innerHTML` fed user input, `any` throughout TypeScript, `cookies()` called without `await` in Next.js 16. The scanner finds these at `file:line` level and fetches current fix guidance from the actual spec.

---

<p align="center">
  <img src="./diagram.webp" alt="ws-mcp architecture — library nodes connected to a central hub, code audit panel, live documentation fetch" width="100%" />
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

No build step. No config file. Node.js 24+. npx pulls the latest version on every session start automatically.

### Optional: GitHub token

ws-mcp fetches README files, release notes, and migration guides from GitHub. Unauthenticated requests are rate-limited to 60/hr. If you hit that, set a token:

```bash
# Claude Code
claude mcp add ws -e WS_GITHUB_TOKEN=ghp_yourtoken -- npx -y @senorit/ws-mcp@latest

# Cursor / Claude Desktop / VS Code
{
  "mcpServers": {
    "ws": {
      "command": "npx",
      "args": ["-y", "@senorit/ws-mcp@latest"],
      "env": { "WS_GITHUB_TOKEN": "ghp_yourtoken" }
    }
  }
}
```

A token with no extra scopes (public repo read) is enough. Raises the limit from 60 to 5000 requests/hr.

---

## Tools

Six tools. Each does one thing and stops there.

| Tool | What it does |
|---|---|
| `ws_resolve_library` | Find a library by name, get its registry entry and docs URL |
| `ws_get_docs` | Fetch live docs for a specific topic within a library |
| `ws_best_practices` | Get patterns, anti-patterns, and config guidance |
| `ws_auto_scan` | Read `package.json` / `requirements.txt` and fetch best practices per dependency |
| `ws_search` | Search OWASP, MDN, web.dev, W3C, official language docs, and AI provider docs |
| `ws_audit` | Scan source files for real issues — exact `file:line` locations and live fix references |

---

## `ws_audit` — code audit tool

Walks your project, finds issues at exact `file:line` locations, and fetches current fix guidance from official sources for every issue type it finds.

### How it works

1. Reads all `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html`, `.py` files up to a configurable limit (default: 50, max: 200)
2. Skips test files, generated files, and commented-out lines (both `//` and `#`)
3. Runs 60+ patterns — sourced from OWASP cheat sheets, typescript-eslint rules, react.dev/reference/rules, web.dev, and the OWASP Python Security Cheat Sheet
4. For the top unique issue types, fetches current fix guidance from the authoritative source
5. Reports each finding with file path, line number, the problem, and a concrete fix

### Audit categories

```
ws_audit({ categories: ["all"] })                      // default — all 9 categories
ws_audit({ categories: ["security", "node"] })         // OWASP + Node.js anti-patterns
ws_audit({ categories: ["python", "security"] })       // Python OWASP scan
ws_audit({ categories: ["accessibility"] })            // WCAG AA scan
ws_audit({ categories: ["typescript", "react"] })      // type safety + React rules
```

| Category | Patterns | What it checks |
|---|---|---|
| `layout` | 6 | CLS-causing images, raw `<img>` vs next/image, 100vh on mobile, missing font-display, render-blocking scripts, CSS `@import` chains |
| `performance` | 7 | Missing lazy loading, useEffect data fetching, barrel file tree-shaking, missing Suspense boundaries, `document.querySelector` in React, inline object/array props, missing fetchpriority on LCP image |
| `accessibility` | 10 | Missing alt text (WCAG 1.1.1), onClick on div/span (WCAG 2.1.1), icon-only buttons without aria-label, inputs without labels, `outline: none`, positive tabIndex, `role="button"` on non-buttons, placeholder href, missing lang, prefers-reduced-motion |
| `security` | 11 | XSS via innerHTML, SQL injection via template literals, command injection, SSRF via user-controlled URLs, path traversal in fs calls, `NEXT_PUBLIC_` secret exposure, hardcoded credentials, unvalidated Server Actions, implied eval, CORS wildcard, dynamic code execution |
| `react` | 7 | forwardRef deprecated (React 19), useFormState renamed, array index as key, missing event listener cleanup, conditional hook calls (Rules of Hooks), component called as function, side effects at render scope |
| `nextjs` | 6 | Sync `cookies()`/`headers()`/`params` without await (Next.js 16), `use client` on layout, Tailwind v3 directives, Route Handler without error handling, `middleware.ts` not renamed to `proxy.ts`, pages without metadata |
| `typescript` | 7 | `any` type, non-null assertions, missing return types, `@ts-ignore`, floating Promises, `require()` instead of import, double assertion |
| `node` | 5 | `console.log` in production, synchronous fs operations, unhandled callback errors, `process.exit()` without cleanup, plain HTTP fetch |
| `python` | 11 | SQL injection via f-string/format(), `eval()`/`exec()` with dynamic input, `subprocess` with `shell=True`, `os.system()`, bare `except:` clauses, `pickle.loads()` from untrusted source, MD5/SHA1 for passwords, `requests verify=False`, mutable default arguments, `print()` in production, `open()` path traversal |

### Options

```typescript
ws_audit({
  projectPath: "./src",       // defaults to cwd
  categories: ["security"],   // or "all" (default)
  maxFiles: 100,              // 1–200, default 50
  tokens: 6000,               // max tokens per docs fetch, default 4000
})
```

### Sample output

```
# Code audit report
> Path: /projects/my-app
> Files scanned: 47 | Issues: 23 | Unique types: 9
> Categories: all

---

## [CRITICAL] SQL built via template literal
Category: security | Severity: critical | Count: 2

Building SQL queries with template literals exposes the app to injection when
user input reaches the string.

Fix: db.query('SELECT * FROM users WHERE id = $1', [userId])

Files:
  - src/db/users.ts:47
  - src/api/search.ts:23

Live fix: OWASP SQL Injection Prevention Cheat Sheet
```

---

## `ws_search` — freeform documentation search

For questions that aren't tied to a specific library. Pulls from OWASP, MDN, web.dev, W3C, official language docs, AI provider docs, and anything else in the topic map below.

```
ws_search({ query: "WCAG 2.2 focus indicators" })
ws_search({ query: "JWT vs session cookies" })
ws_search({ query: "Core Web Vitals LCP optimization" })
ws_search({ query: "gRPC vs REST tradeoffs" })
ws_search({ query: "OpenTelemetry Node.js setup" })
ws_search({ query: "RAG retrieval patterns" })
ws_search({ query: "WebAssembly use cases" })
ws_search({ query: "MCP protocol tool definition" })
```

### Covered topic areas

| Area | Topics |
|---|---|
| Security | OWASP Top 10, SQL injection, XSS / CSP, CSRF, HSTS, authentication, CORS, JWT, OAuth 2.1, OIDC, WebAuthn / passkeys |
| Accessibility | WCAG 2.2, WAI-ARIA, keyboard navigation |
| Performance | Core Web Vitals, image optimization, web fonts, Speculation Rules API |
| Web APIs | Fetch, Web Workers, Service Workers, WebSocket, WebRTC, IndexedDB, Web Crypto, Intersection Observer, ResizeObserver, Web Animations API, WebAssembly |
| CSS | Grid, Flexbox, Container Queries, Custom Properties, View Transitions, Cascade Layers |
| HTTP & protocols | Headers, caching, HTTP/2, HTTP/3, REST, OpenAPI, GraphQL, gRPC / Protocol Buffers, Server-Sent Events |
| Standards | JSON Schema, JSON-LD / Structured Data, OpenTelemetry, Semantic Versioning, MCP Protocol |
| AI | Agents & tool calling, RAG, prompt engineering, vector search / embeddings |
| Infrastructure | Docker, Kubernetes, GitHub Actions, Terraform, monorepo patterns |
| Databases | PostgreSQL, Redis, MongoDB |
| Languages | Rust, Go, Python, Node.js, TypeScript |
| Frameworks | NestJS, Elysia, Payload CMS, Kysely, Pinia, React Native / Expo + full ecosystem |

---

## `ws_auto_scan` — dependency best practices

Point it at your project root and it reads the manifest, figures out what you're actually using, and fetches best practices per dependency.

```
ws_auto_scan({ projectPath: "." })
```

Supports `package.json` (Node.js), `requirements.txt` / `pyproject.toml` (Python — pip, uv, hatch, rye, pdm, Poetry), `Cargo.toml` (Rust), `go.mod` (Go), `pom.xml` (Maven), `build.gradle` / `build.gradle.kts` (Gradle), and `composer.json` (PHP).

---

## Usage

### Natural language

```
use ws for nextjs
use ws for drizzle migrations
ws audit
use ws to check WCAG focus indicators
use ws for OpenTelemetry setup
find all issues and fix with ws
use ws for gRPC
```

### Direct tool calls

```typescript
ws_resolve_library({ libraryName: "nestjs" })
ws_get_docs({ libraryId: "nestjs/nest", topic: "guards" })
ws_best_practices({ libraryId: "vercel/next.js", topic: "caching" })
ws_auto_scan({ projectPath: "." })
ws_search({ query: "OpenTelemetry Node.js distributed tracing" })
ws_audit({ projectPath: ".", categories: ["security", "accessibility"] })
```

---

## Fetch chain

For every library docs request, ws-mcp tries sources in this order and stops at the first one that returns useful content:

1. **`llms.txt` / `llms-full.txt`** — purpose-built LLM context files published by the project maintainer. Accurate and fast because someone actually wrote them for this purpose.
2. **Jina Reader** (`r.jina.ai`) — converts the official docs page to clean markdown. Handles JS-rendered sites that would return nothing via a plain fetch.
3. **GitHub README / releases** — latest release notes and README from the project repository.
4. **npm / PyPI metadata** — fallback for packages outside the curated registry.

---

## Library registry — 330+ libraries

Coverage across every major ecosystem.

| Ecosystem | Libraries |
|---|---|
| React / Next.js | React, Next.js, shadcn/ui, Radix UI, Tailwind CSS, Headless UI, Ariakit, Zag.js, Panda CSS |
| State management | Zustand, Jotai, TanStack Query, SWR, Redux Toolkit, Valtio, MobX, XState, Pinia |
| Backend (Node.js) | Express, Fastify, Hono, NestJS, Elysia, Nitro, tRPC |
| Backend (Python) | FastAPI, Django, Flask, Pydantic |
| Backend (Go) | Gin, Fiber, GORM, chi |
| Backend (Rust) | Axum, Actix Web, sqlx, Tokio |
| Database / ORM | Prisma, Drizzle, Kysely, TypeORM, Mongoose, Knex, Supabase, Neon, Turso, Electric SQL |
| Vector databases | Pinecone, Qdrant |
| AI / ML (JS) | Vercel AI SDK, Anthropic SDK, OpenAI SDK, LangChain.js, LlamaIndex.TS, Transformers.js, Ollama, assistant-ui |
| AI / ML (Python) | LangChain, LlamaIndex, CrewAI, LangGraph, HuggingFace Transformers |
| Testing | Vitest, Playwright, Jest, Testing Library, Cypress, MSW |
| Auth | Clerk, NextAuth, Better Auth, Lucia, Passport.js |
| Validation | Zod, Yup, Valibot, Effect |
| Rich text | Tiptap, Lexical, CodeMirror, Slate.js |
| Content | MDX, unified, Contentlayer, Fumadocs, gray-matter |
| CMS | Payload CMS, Strapi, Contentful |
| Email | Resend, Nodemailer |
| Payments | Stripe |
| Mobile | Expo, React Native, React Navigation, NativeWind, Reanimated, MMKV, FlashList, Skia, Moti |
| Build tools | Vite, Turbopack, SWC, Rollup, Webpack, Biome, ESLint, Prettier, Turborepo, Nx |
| Runtime | Node.js, Bun, Deno |
| Cloud | Vercel, Cloudflare Workers, AWS SDK, Firebase |
| HTTP clients | Axios, ky |
| Real-time | Socket.IO, PartyKit |
| Observability | OpenTelemetry, Sentry, Pino |
| GraphQL clients | Apollo Client, urql |
| HTTP utils | clsx, tailwind-merge |

---

## vs. Context7

Context7 is good. This is what I reach for instead.

| | ws-mcp | Context7 |
|---|---|---|
| Hosting | Self-hosted | Cloud |
| Rate limits | None | Yes |
| Source priority | llms.txt → Jina → GitHub | Doc page embeddings |
| Code audit | Yes — 60+ patterns, 9 categories, file:line, live fixes | No |
| Freeform search | Yes — OWASP, MDN, AI docs, web standards | Library docs only |
| Libraries | 330+ curated + npm/PyPI fallback | ~130 |
| Python / Rust / Go | Yes | Limited |
| API key required | No | No |

---

## Testing

The project ships a full unit test suite — 106 tests across 5 files, covering every audit pattern, all 8 manifest parsers, registry lookup, topic extraction, and sanitization logic.

```bash
npm test                # run all tests
npm run test:coverage   # with V8 coverage report
npm run typecheck       # TypeScript strict check (no emit)
```

Test files:

| File | Coverage |
|---|---|
| `src/sources/registry.test.ts` | LIBRARY_REGISTRY integrity, `lookupById`, `lookupByAlias`, fuzzy search |
| `src/tools/audit.test.ts` | `buildCommentMap`, all 60+ patterns — Python, security, TypeScript, React, Node |
| `src/tools/auto-scan.test.ts` | All 8 manifest parsers using temp directories (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, composer.json, build.gradle) |
| `src/utils/extract.test.ts` | Topic relevance ranking, truncation, document order preservation |
| `src/utils/sanitize.test.ts` | Prompt injection stripping, `<script>`/`<style>` removal, navigation link cleanup |

Tests run in CI on every push and pull request to `main`. See `.github/workflows/ci.yml`.

---

## Requirements

- Node.js 20+
- Claude Code, Cursor, VS Code (MCP extension), or Claude Desktop

---

## Contributing

The library registry is in `src/sources/registry.ts`. Adding a library means a PR with `id`, `name`, `docsUrl`, and `llmsTxtUrl` if the project publishes one. That's it.

Issues and requests: [github.com/rm-rf-prod/ws-mcp/issues](https://github.com/rm-rf-prod/ws-mcp/issues)

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=rm-rf-prod/ws-mcp&type=Date)](https://star-history.com/#rm-rf-prod/ws-mcp&Date)

---

## License

[Elastic License 2.0](./LICENSE) — free to use and self-host. You may not offer it as a managed service or build a competing product from it.
