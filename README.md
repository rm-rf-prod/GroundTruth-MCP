<p align="center">
  <img src="./banner.webp" alt="ws-mcp" width="100%" />
</p>

<h1 align="center">ws-mcp</h1>

<p align="center">
  Self-hosted MCP server that fetches live documentation, runs code audits,<br/>
  and searches authoritative references at query time. Not training data.
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

## Why this exists

Every AI coding assistant hallucinates APIs. Not because the model is bad — because documentation changes faster than training data does. A library ships a major version, deprecates half its API, and the model keeps generating the old patterns for months.

Context7 helps, but it has rate limits, lives in the cloud, and only covers ~130 libraries. When you hit the cap mid-session, you get nothing.

ws-mcp runs on your machine. It fetches documentation directly from the source at query time — `llms.txt` files first, then Jina Reader for JS-rendered docs, then GitHub. No quota. No shared infrastructure. No stale cache. And it covers 330+ libraries, including the full Python AI/ML stack, Go, Rust, and every web standard from OWASP to WebAssembly.

The code audit tool came from a different problem: AI assistants write insecure code by default. SQL built via template literals, `innerHTML` with user input, missing `await` on Next.js async APIs, `any` scattered through TypeScript. The audit scanner finds these at file:line level and fetches the current fix guidance from the actual spec or cheat sheet — not from training data.

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

No build step. No configuration. Node.js 20+.

---

## Tools

Six tools. Each does one thing.

| Tool | What it does |
|---|---|
| `ws_resolve_library` | Find a library by name, get its registry entry and docs URL |
| `ws_get_docs` | Fetch documentation for a specific topic within a library |
| `ws_best_practices` | Get patterns, anti-patterns, and configuration guidance |
| `ws_auto_scan` | Read `package.json` / `requirements.txt` and fetch best practices per dependency |
| `ws_search` | Search OWASP, MDN, web.dev, W3C, WCAG, AI docs, and other authoritative sources |
| `ws_audit` | Scan source files for real issues — exact file:line locations and live fix references |

---

## `ws_audit` — code audit

Walks your project, reports exact file:line locations, and fetches current fix guidance from official sources for every issue type found.

### How it works

1. Reads all `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html` files up to a configurable limit (default: 50, max: 200)
2. Skips test files (`.test.`, `.spec.`, `__tests__/`), generated files, and commented-out lines
3. Runs 50+ patterns — sourced from OWASP cheat sheets, typescript-eslint rules, react.dev/reference/rules, and web.dev
4. For the top unique issue types, fetches current fix guidance from the authoritative source
5. Reports each finding with the file path, line number, problem, and a concrete fix

### Categories

```
ws_audit({ categories: ["all"] })                   // default — all 8 categories
ws_audit({ categories: ["security", "node"] })      // OWASP + Node.js anti-patterns
ws_audit({ categories: ["accessibility"] })         // WCAG AA scan
ws_audit({ categories: ["typescript", "react"] })   // type safety + React rules
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

## `ws_search` — freeform search

Searches any topic without a library name. Pulls from OWASP, MDN, web.dev, W3C, official language docs, AI provider docs, and more.

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

Reads your project manifest and fetches best practices for each dependency automatically.

```
ws_auto_scan({ projectPath: "." })
```

Supports: `package.json` (Node.js), `requirements.txt` (Python), `Cargo.toml` (Rust), `go.mod` (Go), `pom.xml` (Maven).

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

### Direct calls

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

For every library docs request, ws-mcp tries sources in this order:

1. **`llms.txt` / `llms-full.txt`** — purpose-built LLM context files from the project maintainer. Fast and accurate.
2. **Jina Reader** (`r.jina.ai`) — converts the official docs page to clean markdown. Handles JS-rendered sites.
3. **GitHub README / releases** — latest release notes and README from the project repository.
4. **npm / PyPI metadata** — fallback for packages outside the curated registry.

---

## Registry coverage

330+ libraries across every major ecosystem.

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

| | ws-mcp | Context7 |
|---|---|---|
| Hosting | Self-hosted | Cloud |
| Rate limits | None | Yes |
| Source priority | llms.txt → Jina → GitHub | Doc page embeddings |
| Code audit | Yes — 50+ patterns, file:line, live fixes | No |
| Freeform search | Yes — OWASP, MDN, AI docs, web standards | Library docs only |
| Libraries | 330+ curated + npm/PyPI fallback | ~130 |
| Python / Rust / Go | Yes | Limited |
| API key required | No | No |

---

## Auto-updates

Uses `npx -y @senorit/ws-mcp@latest`. On every session start, npx checks npm for the latest version and downloads it automatically. No manual update step.

---

## Requirements

- Node.js 20+
- Claude Code, Cursor, VS Code (MCP extension), or Claude Desktop

---

## Contributing

The library registry lives in `src/sources/registry.ts`. To add a library, open a PR with `id`, `name`, `docsUrl`, and `llmsTxtUrl` if the project publishes one.

Issues and requests: [github.com/rm-rf-prod/ws-mcp/issues](https://github.com/rm-rf-prod/ws-mcp/issues)

---

## License

[Elastic License 2.0](./LICENSE) — free to use and self-host. You may not offer it as a managed service or build a competing product from it.
