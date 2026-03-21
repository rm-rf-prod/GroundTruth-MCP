<div align="center">

```
    ██████╗ ████████╗    ███╗   ███╗  ██████╗ ██████╗
   ██╔════╝ ╚══██╔══╝    ████╗ ████║ ██╔════╝ ██╔══██╗
   ██║  ███╗   ██║       ██╔████╔██║ ██║      ██████╔╝
   ██║   ██║   ██║       ██║╚██╔╝██║ ██║      ██╔═══╝
   ╚██████╔╝   ██║       ██║ ╚═╝ ██║ ╚██████╗ ██║
    ╚═════╝    ╚═╝       ╚═╝     ╚═╝  ╚═════╝ ╚═╝
```

</div>

<p align="center">
  Your AI assistant just confidently wrote deprecated code again.<br/>
  This fixes that.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@groundtruth-mcp/gt-mcp"><img src="https://img.shields.io/npm/v/@groundtruth-mcp/gt-mcp?color=00d4aa&label=npm" alt="npm version" /></a>
  <a href="https://github.com/rm-rf-prod/GroundTruth-MCP/actions/workflows/ci.yml"><img src="https://github.com/rm-rf-prod/GroundTruth-MCP/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-ELv2-orange" alt="Elastic License 2.0" /></a>
  <img src="https://img.shields.io/badge/libraries-unlimited-teal" alt="Unlimited libraries" />
  <img src="https://img.shields.io/badge/audit_patterns-100%2B-red" alt="100+ audit patterns" />
  <img src="https://img.shields.io/badge/tests-704-brightgreen" alt="704 tests" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-green" alt="Node 24+" />
  <img src="https://img.shields.io/badge/status-active%20development-blue" alt="Active Development" />
</p>

<p align="center">
  <b>Actively maintained. New libraries, audit patterns, and features ship regularly.</b><br/>
  GroundTruth checks for updates on startup and notifies you when a new version is available.
</p>

---

## The problem (it's you, but also the model)

Your AI assistant just mass-produced seven files of deprecated code and you merged all of it because the formatting was nice and the variable names were clean. We've all been there. Some of us are still there. Some of us are in production there.

Here's what happened: React shipped v19 and killed `forwardRef`. Next.js made `cookies()` async. Tailwind moved to v4 and nuked `@tailwind` directives. Your model didn't get the memo. It's still writing patterns from the before times with absolute confidence and zero hesitation.

And the security stuff — that's the part that should keep you up at night but doesn't because you don't know about it yet. The model will hand you SQL injection dressed up as a query builder, pass user input to `innerHTML` like it's a feature, and use `any` in TypeScript with the same energy as someone who puts ketchup on steak. It learned from real code. Real code that real people got real fired over.

Context7 is one solution. Cloud-hosted. Rate-limited. Covers about 130 libraries. Works great until you burn through the quota at 11pm debugging a production outage and it serves you a 429 while your Slack is lighting up.

**GroundTruth runs on your machine.** No quota to hit. No cloud to go down. Fetches docs from the source — `llms.txt`, Jina Reader, GitHub — right when you ask. 363+ curated libraries, plus npm, PyPI, crates.io, and pkg.go.dev as fallback. Any public package. Any ecosystem.

The audit tool reads your actual files, finds issues at exact `file:line` locations, and fetches the current fix from the real spec. Not a Medium article. Not a 2019 ESLint plugin. The OWASP cheat sheet that was updated last month.

---

<p align="center">
  <img src="./diagram.webp" alt="GroundTruth architecture — library nodes connected to a central hub, code audit panel, live documentation fetch" width="100%" />
</p>

---

## Install

### Claude Code

```bash
claude mcp add gt -- npx -y @groundtruth-mcp/gt-mcp@latest
```

### Cursor / Claude Desktop / VS Code

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, or `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "gt": {
      "command": "npx",
      "args": ["-y", "@groundtruth-mcp/gt-mcp@latest"]
    }
  }
}
```

No build step. No config file. Node.js 24+. Using `@latest` means npx pulls the newest version on every session start automatically — you always get the latest libraries, audit patterns, and fixes without doing anything.

### Automatic updates

GroundTruth checks npm for new versions on every startup. If a newer version exists, you get a notification:

- **stderr log** — visible in your MCP client's server output
- **MCP logging message** — surfaces in clients that support MCP log notifications
- **Tool response footer** — appended to every tool response until you restart with the latest version

Since the install uses `npx -y @groundtruth-mcp/gt-mcp@latest`, restarting your MCP client (or starting a new session) is enough to get the update. No manual `npm update` needed.

### Optional: GitHub token

GroundTruth fetches README files, release notes, migration guides, and code examples from GitHub. Unauthenticated requests are rate-limited to 60/hr. If you build anything with more than a couple dependencies, you'll hit that by lunch.

```bash
# Claude Code
claude mcp add gt -e GT_GITHUB_TOKEN=ghp_yourtoken -- npx -y @groundtruth-mcp/gt-mcp@latest

# Cursor / Claude Desktop / VS Code
{
  "mcpServers": {
    "gt": {
      "command": "npx",
      "args": ["-y", "@groundtruth-mcp/gt-mcp@latest"],
      "env": { "GT_GITHUB_TOKEN": "ghp_yourtoken" }
    }
  }
}
```

A token with no extra scopes (public repo read) is enough. Takes the limit from 60 to 5000 requests/hr. Takes about 30 seconds to set up. Worth it.

---

## Tools

Ten tools. Each does one thing and stops there.

| Tool | What it does |
|---|---|
| `gt_resolve_library` | Find a library by name — gets the registry entry and docs URL. Falls back to npm, PyPI, crates.io, and pkg.go.dev |
| `gt_get_docs` | Fetch live docs for a specific topic (not whatever was cached six months ago) |
| `gt_best_practices` | Get patterns, anti-patterns, and config guidance for any library |
| `gt_auto_scan` | Read `package.json` / `requirements.txt`, detect lockfile versions, fetch best practices for everything in it |
| `gt_search` | Search OWASP, MDN, web.dev, W3C, official language docs, and AI provider docs |
| `gt_audit` | Scan your source files — finds real issues at exact `file:line` with live fixes attached |
| `gt_changelog` | Fetch release notes before you run `npm update` and regret it |
| `gt_compat` | Check browser and runtime compatibility — before Safari breaks your launch |
| `gt_compare` | Compare 2-3 libraries side-by-side so you can finally pick one and move on |
| `gt_examples` | Search GitHub for real-world code examples of any library or usage pattern |

---

## `gt_audit` — the one that finds what you missed

Walks your project, pinpoints issues at exact `file:line` locations, then fetches current fix guidance from official sources for every issue type it finds. A code reviewer who read the spec this morning and has no feelings about telling you your SQL is injectable.

### How it works

1. Reads all `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html`, `.py` files up to a configurable limit (default: 50, max: 200)
2. Skips test files, generated files, and commented-out lines (both `//` and `#`)
3. Runs 100+ patterns — sourced from OWASP cheat sheets, typescript-eslint rules, react.dev/reference/rules, web.dev, and the OWASP Python Security Cheat Sheet
4. For the top unique issue types, fetches current fix guidance from the authoritative source
5. Reports each finding with file path, line number, the problem, and a concrete fix

### Audit categories

```
gt_audit({ categories: ["all"] })                      // default — all 18 categories
gt_audit({ categories: ["security", "node"] })         // OWASP + Node.js anti-patterns
gt_audit({ categories: ["python", "security"] })       // Python OWASP scan
gt_audit({ categories: ["accessibility"] })            // WCAG AA scan
gt_audit({ categories: ["typescript", "react"] })      // type safety + React rules
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
gt_audit({
  projectPath: "./src",       // defaults to cwd
  categories: ["security"],   // or "all" (default)
  maxFiles: 100,              // 1-200, default 50
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

## `gt_changelog` — read this before running `npm update`

Fetches release notes for any library. Hits GitHub Releases API first, falls back to CHANGELOG.md, then the docs site changelog page. Pass a version filter to see just what changed in the version you're moving to — not a wall of history going back to 2018.

```
gt_changelog({ libraryId: "vercel/next.js" })
gt_changelog({ libraryId: "facebook/react", version: "19" })
gt_changelog({ libraryId: "prisma", version: "6.0.0" })
```

---

## `gt_compat` — does this actually work in Safari

Checks whether a web API, CSS feature, or JavaScript syntax is safe to use in your target environments. Pulls live data from MDN and caniuse.com. Run this before you ship the feature, not after your QA person opens it on an iPhone.

```
gt_compat({ feature: "CSS container queries" })
gt_compat({ feature: "Array.at()" })
gt_compat({ feature: "Web Bluetooth API" })
gt_compat({ feature: "CSS :has() selector", environments: ["safari", "firefox"] })
```

---

## `gt_compare` — pick one already

Side-by-side comparison of 2-3 libraries. Fetches live docs for each and filters to content relevant to your criteria. Useful for the "prisma vs drizzle" debate you've been having with yourself for three weeks while using neither.

```
gt_compare({ libraries: ["prisma", "drizzle-orm"] })
gt_compare({ libraries: ["trpc", "hono"], criteria: "TypeScript support" })
gt_compare({ libraries: ["zod", "valibot", "yup"], criteria: "bundle size DX" })
gt_compare({ libraries: ["react", "solid-js"], criteria: "performance rendering" })
```

---

## `gt_examples` — see how other people actually use it

Searches GitHub for real-world usage examples of any library or pattern. Returns code snippets from popular open-source projects with file paths and repository attribution. Useful when the docs tell you what an API does but not how anyone actually uses it in production.

```
gt_examples({ library: "drizzle-orm" })
gt_examples({ library: "tanstack/query", pattern: "useMutation" })
gt_examples({ library: "fastapi", pattern: "middleware", language: "python" })
gt_examples({ library: "hono", pattern: "auth guard", maxResults: 10 })
```

Requires `GT_GITHUB_TOKEN` for higher rate limits. Without a token, GitHub Code Search allows 10 requests per minute.

---

## `gt_search` — anything that isn't a specific library

For questions not tied to a particular package. Pulls from OWASP, MDN, web.dev, W3C, official language docs, AI provider docs, Google developer docs, and everything else in the topic map below. Good for when you know what you need but not which library page it lives on.

```
gt_search({ query: "WCAG 2.2 focus indicators" })
gt_search({ query: "JWT vs session cookies" })
gt_search({ query: "Core Web Vitals LCP optimization" })
gt_search({ query: "gRPC vs REST tradeoffs" })
gt_search({ query: "OpenTelemetry Node.js setup" })
gt_search({ query: "RAG retrieval patterns" })
gt_search({ query: "Google Gemini API function calling" })
gt_search({ query: "Claude tool use best practices" })
gt_search({ query: "OpenAI structured output" })
gt_search({ query: "Firebase Firestore security rules" })
```

### Covered topic areas

| Area | Topics |
|---|---|
| Security | OWASP Top 10, SQL injection, XSS / CSP, CSRF, HSTS, authentication, CORS, JWT, OAuth 2.1, OIDC, WebAuthn / passkeys, SSRF, file upload security, clickjacking, path traversal, API security, supply chain / SBOM |
| Accessibility | WCAG 2.2, WAI-ARIA, keyboard navigation |
| Performance | Core Web Vitals, image optimization, web fonts, Speculation Rules API |
| Web APIs | Fetch, Web Workers, Service Workers, WebSocket, WebRTC, IndexedDB, Web Crypto, Intersection Observer, ResizeObserver, Web Animations API, WebAssembly, AbortController, File System Access API |
| CSS | Grid, Flexbox, Container Queries, Custom Properties, View Transitions, Cascade Layers, Nesting, :has(), Subgrid, Scroll-driven Animations, oklch / color-mix, @scope |
| HTTP & protocols | Headers, caching, HTTP/2, HTTP/3, REST, OpenAPI, GraphQL, gRPC / Protocol Buffers, Server-Sent Events, JSON Schema |
| Standards | JSON-LD / Structured Data, OpenTelemetry, Semantic Versioning, MCP Protocol, Intl API, i18n / Localization |
| Google APIs | Gemini API, Maps API, Analytics 4, Ads API, Search Console, Sheets API, Drive API, Calendar API, OAuth / Identity, Tag Manager, reCAPTCHA, Lighthouse / PageSpeed, YouTube API, Gmail API, Workspace / Apps Script, Custom Search, Chrome Extensions, SEO guidelines, Fonts API |
| Google Cloud | Cloud Run, Cloud Functions, Cloud Storage, BigQuery, Pub/Sub, Vertex AI, Vision API, Speech APIs, Translation, Natural Language, GKE, IAM |
| Firebase | Firestore, Authentication, Cloud Functions, Hosting |
| Anthropic / Claude | Claude API, tool use, prompt caching, vision, extended thinking, computer use, streaming, message batches, PDF support, citations, models, rate limits, Claude Code, Agent SDK |
| OpenAI | Chat API, Responses API, function calling, structured output, embeddings, fine-tuning, vision, image generation, Whisper / STT, TTS, Realtime API, Batch API, moderation, Agents SDK, rate limits, production best practices |
| AI providers | Mistral AI, Cohere, Groq, Replicate, Together AI, Hugging Face |
| AI frameworks | LangChain, LangGraph, LlamaIndex, CrewAI, AutoGen |
| AI concepts | Agents & tool calling, RAG, prompt engineering, vector search / embeddings, fine-tuning, AI safety, evaluation, multimodal AI, code generation, voice AI |
| Vector databases | Pinecone, Chroma, Weaviate |
| Infrastructure | Docker, Kubernetes, GitHub Actions, Terraform, Cloudflare Workers, monorepo patterns |
| Databases | PostgreSQL, Redis, MongoDB |
| Languages | Rust, Go, Python, Node.js, TypeScript |
| Frameworks | NestJS, Elysia, Angular, Flutter, Payload CMS, Kysely, Pinia, React Native / Expo + full ecosystem, Material Design |

---

## `gt_auto_scan` — best practices for your whole stack at once

Point it at your project root. It reads the manifest, figures out what you're actually using, and pulls best practices for each dependency. One call instead of twenty, zero arguments required if you're already in the project folder.

```
gt_auto_scan({ projectPath: "." })
```

Supports `package.json` (Node.js), `requirements.txt` / `pyproject.toml` (Python — pip, uv, hatch, rye, pdm, Poetry), `Cargo.toml` (Rust), `go.mod` (Go), `pom.xml` (Maven), `build.gradle` / `build.gradle.kts` (Gradle), and `composer.json` (PHP).

---

## Usage

### Natural language

```
use gt for nextjs
use gt for drizzle migrations
gt audit
use gt to check WCAG focus indicators
use gt for OpenTelemetry setup
find all issues and fix with gt
use gt for gRPC
use gt for Google Gemini API
use gt for Claude tool use
```

### Direct tool calls

```typescript
gt_resolve_library({ libraryName: "nestjs" })
gt_get_docs({ libraryId: "nestjs/nest", topic: "guards" })
gt_best_practices({ libraryId: "vercel/next.js", topic: "caching" })
gt_auto_scan({ projectPath: "." })
gt_search({ query: "OpenTelemetry Node.js distributed tracing" })
gt_search({ query: "Google Gemini API function calling" })
gt_search({ query: "Claude prompt caching" })
gt_audit({ projectPath: ".", categories: ["security", "accessibility"] })
gt_changelog({ libraryId: "vercel/next.js", version: "15" })
gt_compat({ feature: "CSS container queries", environments: ["safari"] })
gt_compare({ libraries: ["prisma", "drizzle-orm"], criteria: "TypeScript support" })
gt_examples({ library: "hono", pattern: "middleware" })
```

---

<p align="center">
  <img src="./network.webp" alt="GroundTruth — documentation source network: llms.txt, OWASP, MDN, GitHub, npm" width="100%" />
</p>

## How docs are fetched

For every library docs request, GroundTruth tries sources in this order and stops at the first one that returns useful content:

1. **`llms.txt` / `llms-full.txt`** — context files published by the project maintainer specifically for LLM consumption. More reliable than scraping the docs site.
2. **Jina Reader** (`r.jina.ai`) — converts the official docs page to clean markdown. Handles JS-rendered sites that would return nothing via a plain fetch.
3. **GitHub README / releases** — latest release notes and README from the project repository.
4. **npm / PyPI / crates.io / pkg.go.dev** — fallback for packages outside the curated registry, with automatic `llms.txt` probing on discovered homepages.

---

## Library coverage — unlimited

363+ curated entries in the registry, plus automatic fallback to npm, PyPI, crates.io, and pkg.go.dev. Any public package in any major ecosystem is resolvable — the registry gives you curated quality, the fallbacks give you universal reach.

| Ecosystem | Libraries |
|---|---|
| React / Next.js | React, Next.js, shadcn/ui, Radix UI, Tailwind CSS, Headless UI, Ariakit, Zag.js, Panda CSS |
| State management | Zustand, Jotai, TanStack Query, SWR, Redux Toolkit, Valtio, MobX, XState, Pinia |
| Backend (Node.js) | Express, Fastify, Hono, NestJS, Elysia, Nitro, tRPC |
| Backend (Python) | FastAPI, Django, Flask, Pydantic |
| Backend (Go) | Gin, Fiber, GORM, chi |
| Backend (Rust) | Axum, Actix Web, sqlx, Tokio |
| Database / ORM | Prisma, Drizzle, Kysely, TypeORM, Mongoose, Knex, Supabase, Neon, Turso, Electric SQL |
| Vector databases | Pinecone, Chroma, Weaviate, Qdrant |
| AI / LLM providers | Anthropic Claude API, OpenAI API, Google Gemini API, Mistral AI, Cohere, Groq, Replicate, Together AI, Fireworks AI |
| AI SDKs (JS/TS) | Vercel AI SDK, Anthropic SDK, OpenAI SDK, Google Generative AI, LangChain.js, Transformers.js, Ollama, assistant-ui |
| AI SDKs (Python) | Anthropic Python SDK, OpenAI Python SDK, Google Gemini Python SDK, LangChain, LlamaIndex, CrewAI, LangGraph, AutoGen, HuggingFace Transformers |
| AI agents | Claude Code, Claude Agent SDK, OpenAI Agents SDK |
| AI audio / voice | ElevenLabs, Deepgram, AssemblyAI |
| AI image / video | Stability AI, fal.ai |
| Google | Firebase, Google Cloud, Google Maps API, Google APIs Client, Vertex AI, Angular, Flutter, Material Design |
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
| Cloud | Vercel, Cloudflare Workers, AWS SDK, Firebase, Google Cloud |
| Monitoring | Sentry, PostHog, OpenTelemetry, Pino |
| Automation | n8n, Trigger.dev |
| HTTP clients | Axios, ky |
| Real-time | Socket.IO, PartyKit |
| GraphQL clients | Apollo Client, urql |
| ML / Deep learning | PyTorch, TensorFlow, HuggingFace Transformers |
| Serverless | Upstash Redis |

---

## vs. Context7

Context7 is solid. Here's why I reach for this instead.

| | GroundTruth | Context7 |
|---|---|---|
| Hosting | Self-hosted | Cloud |
| Rate limits | None | Yes |
| Source priority | llms.txt -> Jina -> GitHub | Doc page embeddings |
| Code audit | Yes — 100+ patterns, 18 categories, file:line, live fixes | No |
| Freeform search | Yes — OWASP, MDN, AI docs, Google APIs, web standards | Library docs only |
| Changelog lookup | Yes — GitHub Releases, CHANGELOG.md, docs site | No |
| Browser compatibility | Yes — MDN + caniuse.com | No |
| Library comparison | Yes — 2-3 libraries side-by-side, any criteria | No |
| Code examples | Yes — GitHub Code Search for real-world usage | No |
| Lockfile detection | Yes — reads exact versions from lockfiles | No |
| Libraries | Unlimited — 363+ curated + npm/PyPI/crates.io/Go fallback | ~130 |
| AI coverage | Claude, OpenAI, Gemini, Mistral, Cohere, Groq, LangChain, LlamaIndex, CrewAI, 20+ more | Limited |
| Google APIs | Full coverage — Maps, Analytics, Ads, Cloud, Firebase, Vertex AI, 30+ services | Partial |
| Python / Rust / Go | Yes | Limited |
| Update notifications | Yes — notifies when new version available | No |
| API key required | No | No |

The two tools approach the same problem from different angles. Context7 embeds doc pages and retrieves them by semantic similarity. GroundTruth fetches from the source at query time and prioritizes `llms.txt` files — content the maintainers specifically wrote for LLM consumption. Neither is universally better, but when you hit a rate limit at 11pm debugging a production issue, "self-hosted with no quota" stops being a nice-to-have.

---

## Tests

704 tests across 22 files. Every audit pattern has a test. Every manifest parser has a test. If a pattern ships without a test, the CI pipeline says no before any human has to.

```bash
npm test                # run all tests
npm run test:coverage   # with V8 coverage report
npm run typecheck       # TypeScript strict check (no emit)
```

| File | Coverage |
|---|---|
| `src/sources/registry.test.ts` | LIBRARY_REGISTRY integrity, `lookupById`, `lookupByAlias`, fuzzy search |
| `src/tools/audit.test.ts` | `buildCommentMap`, all 100+ patterns — Python, security, TypeScript, React, Node |
| `src/tools/auto-scan.test.ts` | All 8 manifest parsers using temp directories (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, composer.json, build.gradle) |
| `src/utils/extract.test.ts` | Topic relevance ranking, truncation, document order preservation |
| `src/utils/sanitize.test.ts` | Prompt injection stripping, `<script>`/`<style>` removal, navigation link cleanup |
| `src/utils/lockfile.test.ts` | Lockfile version detection for package-lock, pnpm-lock, yarn.lock, Cargo.lock |
| `src/tools/examples.test.ts` | GitHub Code Search, caching, rate limit handling, error states |
| `src/utils/version-check.test.ts` | Version comparison, update notification formatting, pending update state |

Tests run in CI on every push and pull request to `main`. See `.github/workflows/ci.yml`.

---

## Environment variables

All optional. GroundTruth works out of the box with zero configuration.

| Variable | Purpose | Default |
|---|---|---|
| `GT_GITHUB_TOKEN` | GitHub API auth — raises rate limit from 60 to 5000 req/hr | none |
| `GT_CACHE_DIR` | Disk cache location for persistent cross-session caching | `~/.gt-mcp-cache` |
| `GT_CONCURRENCY` | Parallel fetch limit in `gt_auto_scan` | `6` |

---

## Requirements

- Node.js 24+
- Claude Code, Cursor, VS Code (MCP extension), or Claude Desktop

That's it. No Docker. No config files. No environment variables unless you want the GitHub token.

---

## Active development

GroundTruth is under active development. New curated registry entries, audit patterns, search topics, and features are added regularly. The registry covers 363+ libraries with deep curated metadata, and automatic fallback to npm, PyPI, crates.io, and pkg.go.dev means any public package is resolvable out of the box.

Recent additions include comprehensive coverage for Google Gemini API, Anthropic Claude API (tool use, prompt caching, vision, extended thinking, computer use, streaming, batches), OpenAI API (chat, responses, function calling, structured output, embeddings, fine-tuning, realtime, agents), and 20+ additional AI providers and frameworks.

To stay updated:
- **Star and watch** the [GitHub repo](https://github.com/rm-rf-prod/GroundTruth-MCP) for release notifications
- **Use `@latest`** in your MCP config (the default install command) — npx fetches the newest version automatically
- **Check tool responses** — GroundTruth appends an update notice when a newer version is available

---

## Contributing

The library registry lives in `src/sources/registry.ts`. Adding a library is a PR with `id`, `name`, `docsUrl`, and `llmsTxtUrl` if the project publishes one. If you've been frustrated by a library not being covered, that's the fix — it takes about five minutes.

Issues and requests: [github.com/rm-rf-prod/GroundTruth-MCP/issues](https://github.com/rm-rf-prod/GroundTruth-MCP/issues)

---

## Full documentation

Want the full technical breakdown? Architecture, every tool's input schema, every audit pattern, the fetch pipeline, caching internals, the obfuscation build, and how the registry works?

**[Read the full docs](./docs/DOCUMENTATION.md)** — everything in one place, for the people who actually read documentation before using a tool.

---

## Star history

<a href="https://star-history.com/#rm-rf-prod/GroundTruth-MCP&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rm-rf-prod/GroundTruth-MCP&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rm-rf-prod/GroundTruth-MCP&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=rm-rf-prod/GroundTruth-MCP&type=Date" />
  </picture>
</a>

---

## License

[Elastic License 2.0](./LICENSE) — free to use, free to self-host, free to build on. The one thing you can't do is turn it into a managed service and sell it. Fair enough.
