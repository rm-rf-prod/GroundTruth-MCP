# Changelog

## [3.0.0] — 2026-03-21

- feat: automate private registry swap in publish pipeline

---

## [2.6.0] — 2026-03-21

- feat: registry deep coverage — 100% bestPracticesPaths and urlPatterns

---

## [2.5.7] — 2026-03-21

### Registry deep coverage enhancement

Every public registry entry now has full `bestPracticesPaths` and `urlPatterns` coverage (100%, up from 26% and 7%). This means first-try hits on curated documentation paths instead of falling through to slow generic fallbacks.

- feat: add bestPracticesPaths to all 97 public registry entries (was 23)
- feat: add urlPatterns to all 97 public registry entries (was 6)
- feat: add llmsFullTxtUrl for Svelte, Hono, Astro, Nuxt
- feat: expand BEST_PRACTICES_URLS with 51 new library entries (230+ total)
- feat: add 9 new GENERIC_BP_SUFFIXES patterns (30 total): advanced, security, performance, deployment, configuration, migration, testing, troubleshooting, best-practices
- fix: remove broken llmsTxtUrl for Tailwind CSS (404)
- fix: add missing pypiPackage to FastAPI and Django
- fix: remove duplicate alias "sveltekit" (was on both sveltejs/svelte and sveltejs/kit)
- fix: fix Express urlPattern `/en/4x/api` to use `{slug}` template
- fix: add BEST_PRACTICES_URLS ID aliases for registry/BP key mismatches (mongoose, astro, effect, anthropic-sdk)
- test: add 7 new structural validation tests for registry entries (llmsTxtUrl HTTPS, bestPracticesPaths format, urlPatterns {slug}, alias uniqueness, field coverage)
- chore: sync improvements to private registry entries

### Stats

- 762 tests across 25 files (up from 755)
- 97 public registry entries with 100% bestPracticesPaths and urlPatterns coverage
- 230+ curated best-practice URL entries
- 30 generic fallback path patterns

---

## [2.5.6] — 2026-03-21

- fix: improve doc quality for Supabase and all libraries
- fix: improve docs quality for topic queries and library resolution
- chore: gitignore publishing guide

---

## [2.5.5] — 2026-03-21

- See diff for changes.

---

## [2.5.4] — 2026-03-21

- fix: close DNS rebinding TOCTOU gap with undici global dispatcher
- fix: move mcp-publisher to release scripts after npm publish

---

## [2.5.3] — 2026-03-21

- fix: resolve all remaining security issues to enterprise grade

---

## [2.5.2] — 2026-03-21

- fix: security hardening, CI pipeline, and visibility improvements
- feat: auto-publish to MCP Registry on version bump
- fix: shorten registry description, push only new version tag

---

## [2.5.1] — 2026-03-21

- feat: add MCP Registry support
- fix: remove bottom line of ASCII art
- fix: adjust last ASCII art line alignment
- fix: align last line of ASCII art one space left
- style: switch to box-drawing ASCII art style
- fix: equalize ASCII art line widths for alignment
- fix: center ASCII art using table wrapper
- fix: center GT MCP ASCII art using inline code blocks
- style: polish header text styling and copy
- fix: center GT MCP ASCII art with pre tag
- feat: GT MCP ASCII art banner centered
- feat: replace banner with GT ASCII art
- Revert "fix: remove star history section from README"
- fix: remove star history section from README
- feat: add ASCII art banner to README

---

## [2.5.0] — 2026-03-21

### New tools
- **`gt_examples`** — search GitHub for real-world code examples of any library or pattern. Returns code snippets from popular open-source projects with repository attribution. Requires `GT_GITHUB_TOKEN` for higher rate limits.

### New features
- **Lockfile version detection** — `gt_auto_scan` now reads `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, and `Cargo.lock` to detect exact installed versions. Versions are passed to the documentation fetch query for more targeted results.
- **crates.io fallback** — `gt_resolve_library` now falls back to crates.io for Rust crates when no registry match is found.
- **Go pkg.go.dev fallback** — `gt_resolve_library` now falls back to pkg.go.dev for Go modules.
- **llms.txt probing** — npm and PyPI fallback resolution now probes the package homepage for `llms.txt` and `llms-full.txt` files, improving documentation quality for unregistered libraries.
- **Content integrity hashing** — all fetched documents now include a SHA-256 content hash (16-char prefix) and fetch timestamp in the response, enabling change detection across sessions.
- **Configurable concurrency** — `gt_auto_scan` parallel fetch limit is now configurable via `GT_CONCURRENCY` env var (default: 6, was hardcoded 4).

### Types
- `LibraryMatch` gains `llmsFullTxtUrl` field and `source` union expanded with `"crates"` and `"go"`
- `FetchResult` gains `contentHash` and `fetchedAt` fields
- `DiskCacheFile` gains `contentHash` field

### Stats
- 704 tests across 22 files (up from 565)
- 10 MCP tools (up from 9)

---

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

565 tests across 19 files. Tests run in CI on every push and pull request to `main`.

### CI

Three jobs on push and pull request to `main`: `typecheck` (tsc --noEmit), `test` (vitest run --coverage), `build` (tsc + obfuscator + npm audit). Build requires both to pass. Action SHAs pinned for supply chain integrity, Node.js 24 native runtimes throughout.

### Install

Running `npm install` displays your install ID and the Elastic License 2.0 terms. Free for personal and internal use. Commercial redistribution or hosting as a service requires a commercial license.
