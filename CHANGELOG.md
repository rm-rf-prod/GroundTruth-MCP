# Changelog

## [2.4.1] — 2026-03-21

- feat: expand registry with Google, AI providers, vector DBs + version check system
- chore: update lockfile with eslint dependencies

---

## [2.4.0] — 2026-03-19

- refactor: perf, type safety, and linting improvements

---

## [2.3.2] — 2026-03-19

- fix: add path traversal and SSRF guards to audit, auto-scan, docs, fetcher
- fix: rename gt-mcp-server to GroundTruth in User-Agent and test
- fix: update SERVER_NAME test to GroundTruth

---

## [2.3.1] — 2026-03-19

- chore: rename SERVER_NAME to GroundTruth
- chore: add release scripts, fix README test badge 534→593
- fix: restore SERVER_VERSION, replace shell-broken version script with update-version.mjs

---

## [2.3.0] — 2026-03-19

- chore: update README stats
- feat: v2.3.0 — version-specific docs, devdocs.io, MCP prompts, outputSchema
- feat: v2.2.0 — license gate, source-map fix

---

## [2.3.0] — 2026-03-19

### New — version-specific doc retrieval

`gt_get_docs` and `gt_best_practices` now accept an optional `version` parameter. Pass `"14"`, `"3.0.0"`, or `"v18.2.0"` to scope results to a specific release.

- `gt_get_docs`: tries the GitHub tag README at `raw.githubusercontent.com/<repo>/<tag>/README.md` first, then falls back to the npm versioned package page at `npmjs.com/package/<pkg>/v/<version>`.
- `gt_best_practices`: applies version to the extraction topic (e.g., `"routing v14.0.0"`) so BM25 ranking surfaces version-relevant content from the fetched docs.

### New — devdocs.io in `gt_search`

`gt_search` now includes devdocs.io as a step-3 fallback source covering 200+ technologies: Go, Rust, Python stdlib, Ruby, PostgreSQL, MySQL, Redis, MongoDB, Nginx, Apache, and more. Activated only when the primary curated sources return no results, keeping latency low for common queries.

### New — 5 MCP prompts

Discoverable workflow templates shown as slash commands in Claude Desktop and compatible MCP clients:

| Prompt | Argument | Calls |
|---|---|---|
| `audit-my-project` | — | `gt_audit` |
| `upgrade-check` | `library` | `gt_changelog` |
| `best-practices-scan` | — | `gt_auto_scan` |
| `compare-libraries` | `libraries` | `gt_compare` |
| `security-check` | `topic` | `gt_search` (OWASP) |

### New — `outputSchema` on all 9 tools

All tools now declare a formal JSON Schema `outputSchema`, enabling client-side validation of `structuredContent` shapes and better IDE/agent tooling.

### Security — expanded injection pattern detection

Five new patterns added to `INJECTION_PATTERNS` in `constants.ts`:

- HTML comment injection: `<!-- ignore above, do X -->`
- Unicode direction override characters (U+202A–202E, U+2066–2069)
- "act as ... you are an AI" role-switch pattern
- "pretend you are / pretend to be" reframing pattern
- "from now on ... you/ignore/forget" instruction override pattern

### Fixes

- `USER_AGENT` version string now reads from `SERVER_VERSION` at runtime instead of being hardcoded as `"1.0"`

### Tests — 593 across 19 files

28 new tests covering: version param fetch paths (GitHub tag, npm versioned page, fallback), `effectiveTopic` construction, devdocs.io integration, and all 5 MCP prompt registrations.

---

## [2.2.0] — 2026-03-19

### Tools — Nine total

- `gt_resolve_library` — find a library by name, get its registry entry and docs URL
- `gt_get_docs` — fetch live docs for a specific topic within a library
- `gt_best_practices` — get patterns, anti-patterns, and config guidance
- `gt_auto_scan` — read `package.json` / `requirements.txt` / `Cargo.toml` / `go.mod` / etc., fetch best practices per dependency
- `gt_search` — freeform search across OWASP, MDN, web.dev, W3C, AI provider docs, and more
- `gt_audit` — scan source files for real issues at exact `file:line` with live fix references from the authoritative source
- `gt_changelog` — fetch release notes for any library; GitHub Releases → CHANGELOG.md → docs site, with optional version filter
- `gt_compat` — browser and runtime compatibility from MDN and caniuse.com; accepts optional environment list
- `gt_compare` — side-by-side comparison of 2–3 libraries on any criteria, docs fetched in parallel

### Library registry — 363+ entries

Covers every major ecosystem: React/Next.js, Vue, Svelte, Angular, SolidJS, Astro, Remix, Nuxt, SvelteKit, backend (Node.js, Python, Go, Rust), databases and ORMs, AI/ML SDKs, testing, auth, validation, CMS, mobile (React Native, Expo), build tools, runtimes (Node.js, Bun, Deno), cloud, observability, real-time, and more.

`llms.txt` priority fetch chain: llms.txt → llms-full.txt → Jina Reader → GitHub README → npm/PyPI metadata.

### Audit — 100+ patterns across 18 categories

| Category | Patterns |
|---|---|
| `layout` | CLS-causing images, 100vh on mobile, missing font-display, render-blocking scripts, CSS @import chains |
| `performance` | Missing lazy loading, useEffect fetching, barrel file tree-shaking, missing Suspense, inline object/array props |
| `accessibility` | Missing alt, onClick on div, icon buttons without aria-label, inputs without labels, outline:none, missing lang |
| `security` | XSS via innerHTML, SQL injection, command injection, SSRF, path traversal, NEXT_PUBLIC_ secret exposure, hardcoded credentials |
| `react` | forwardRef deprecated, useFormState renamed, array index as key, conditional hooks, component called as function |
| `nextjs` | Sync cookies()/headers()/params, use client on layout, Tailwind v3 directives, middleware.ts not renamed |
| `typescript` | any type, non-null assertions, @ts-ignore, floating Promises, double assertion |
| `node` | console.log in production, sync fs, unhandled callbacks, process.exit without cleanup |
| `python` | SQL via f-string, eval/exec with dynamic input, subprocess shell=True, os.system, bare except, pickle from untrusted source |
| `vue` | v-for without :key, prop mutation, Options API vs script setup |
| `svelte` | Svelte 4 patterns in Svelte 5 projects (createEventDispatcher, $: reactives, on: directives) |
| `angular` | Missing takeUntilDestroyed, legacy *ngIf/*ngFor, imperative DOM |
| `testing` | waitForTimeout in tests, test.only left in, console.log in tests |
| `mobile` | Missing keyExtractor on FlatList, inline style objects, missing accessible prop |
| `api` | Unhandled DB calls, stack traces in responses, missing rate limiting |
| `css` | !important overuse, pixel font sizes, z-index:9999, missing prefers-reduced-motion |
| `seo` | Missing generateMetadata, img without alt, multiple h1, hardcoded title |
| `i18n` | Hardcoded strings outside t(), toLocaleString without locale, hardcoded currency symbols |

Source files scanned: `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html`, `.py`. Test files, generated files, and commented-out lines skipped automatically.

### Auto-scan — 11 manifest formats

`package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle` / `build.gradle.kts`, `composer.json`, `Gemfile`, `deno.json` / `deno.jsonc`, `pubspec.yaml`

### Search — topic coverage

55+ curated topic entries spanning: OWASP Top 10, SQL injection, XSS/CSP, CSRF, WebAuthn, WCAG 2.2, WAI-ARIA, Core Web Vitals, Web APIs (Fetch, Workers, WebSocket, WebRTC, IndexedDB, Web Crypto, WebAssembly), CSS (Grid, Flexbox, Container Queries, View Transitions, Cascade Layers), HTTP/2, HTTP/3, GraphQL, gRPC, OpenTelemetry, RAG, agents, prompt engineering, Docker, Kubernetes, GitHub Actions, Terraform, monorepo patterns, and more.

20+ authoritative domains: OWASP, MDN, web.dev, W3C, WCAG, Cloudflare, Supabase, Redis, MongoDB, Socket.IO, Fastify, tRPC, Better Auth, Payload CMS, Bun, Deno, Storybook, Motion, Three.js, SolidJS, Remix, Nuxt, Effect, Valibot.

### Tests — 565 across 19 files

Every audit pattern, every manifest parser, every tool, every utility — fully covered. Tests run in CI on every push and pull request to `main`.

### CI

Three jobs on push and pull request to `main`: `typecheck` (tsc --noEmit), `test` (vitest run --coverage), `build` (tsc + obfuscator + npm audit). Build requires both to pass. Action SHAs pinned for supply chain integrity, Node.js 24 native runtimes throughout.

### Install

Running `npm install` displays your install ID and the Elastic License 2.0 terms. Free for personal and internal use. Commercial redistribution or hosting as a service requires a commercial license.
