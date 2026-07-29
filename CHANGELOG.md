# Changelog

## [7.4.1] — 2026-07-29

- fix: scope publish audit gate to production dependencies
- fix: apply same production-scoped audit gate to Security workflow
- fix: repair CI audit gate and dead Effect doc URLs
- chore: bump MCP SDK to 1.30 and dev toolchain

---

## [7.4.0] — 2026-07-15

- fix: adversarially verified hardening across all 14 tools
- docs: expand 7.3.0 changelog entry

---

## [7.3.0] — 2026-07-10

- feat: gt_compat redesigned on MDN machine-readable data (index.json + BCD API) — exact per-browser version_added incl. Node/Deno/Bun, Baseline status
- feat: gt_snippets multi-hop traversal (index links, child pages, sitemap) — frameworks whose llms.txt is a link index now yield snippets
- feat: nested llms.txt pointer following, relative-link index support, path-scoped sitemap discovery, legacy-version-tree ranking penalty
- feat: gt_search authority-ranked sources (official docs above content farms) + full evidence coverage per source on specific queries
- feat: gt_migration web-search escalation for upgrade guides at unguessable URLs; gt_examples official-docs fallback (GitHub code search is auth-only)
- fix: gt_get_docs index-content escalation + latency guard; raceUrls ranks topic-first; dispatch routes natural browser-support phrasing to gt_compat

---

## [7.2.0] — 2026-07-10

- feat: multi-source retrieval, Jina 404 gate, prose-only evidence
- feat: topic-synonym discovery (migration/upgrade, performance/optimization), index-first deep-fetch, link-list guard
- feat: weekly URL-health CI workflow; 73 rotted curated URLs replaced with live-verified pages
- fix: query-meta words no longer count as topic evidence; shared web-search helper in gt_search
- chore: undici 8.7.0 + hono 4.12.28 (clears 2 high-severity production advisories)

---

## [7.1.0] — 2026-06-12

- feat: evidence engine — verified topic coverage, no generic answers

---

## [7.0.4] — 2026-06-03

- fix: eliminate documentation noise across all MCP tools
- chore: sync llms.txt to 7.0.3 and auto-stage it on version bump

---

## [7.0.3] — 2026-06-02

- docs: sync generated stats (1198 tests, 14 tools)
- test: add 78 regression tests for the audit-hardening fixes
- ci: pin actions, gate release scripts, automate stat writeback
- refactor: extract server instructions to a testable module
- perf: cut tokenization cost and fetch fan-out
- fix: correct resolver, router, scanner and tool defects from audit
- fix: harden security and reliability from deep audit (wave 2)
- chore: sync llms.txt stats for 7.0.2

---

## [7.0.2] — 2026-06-02

- fix: backfill registry languages, cover gt_dispatch, sync docs
- fix: correct resolver, migration band and compat cache defects
- fix: harden security, reliability and observability from deep audit
- chore: gitignore docs/ — internal planning docs, local-only
- fix(scripts): stop version-sweep from rewriting .github action versions

---

## [7.0.1] — 2026-05-30

- chore: ignore local draft artifacts
- docs: record implementation status (done / skipped-as-wrong / deferred)
- fix(resolve): key llms.txt probe cache on full path, not origin
- perf: snippet IDF ranking, cache + lockfile + telemetry cleanup
- build: upgrade to TypeScript 6.0 + NodeNext, align Node 24
- fix: reliability, security and protocol hardening
- fix(audit): use charOffset for repeated-line context windows
- fix: version-aware migration/changelog pipeline
- docs: add enterprise upgrade plan
- chore: shorten server.json description (MCP registry 100-char limit)
- chore: stats — README library count 444 -> 445

---

## [7.0.0] — 2026-05-28

Adds a dispatch tool, hardens the security model, and instruments every tool with telemetry.

### Added
- `gt_dispatch` (14th tool). Takes a plain-text intent ("use gt mcp", "find issues", "use gt for next.js") and returns a routing decision with tool, args, reason, and confidence. Falls back to a structured "next steps" response when nothing else fits.
- `src/services/intent-router.ts`. Deterministic plain-text to tool routing. 13 verb-hint categories, URL detection, library-alias lookup against the registry, migration-version extraction, project-level detection. Also renders the routing table embedded in `server.instructions`.
- `src/services/telemetry.ts`. Request lifecycle tracking. Per-tool success, resolve, and error counters. p50 and p95 latency. 200-call recent outcome window. Structured logs. Exposed via the `/health` endpoint and the `withTelemetry(name, fn)` wrapper.
- `src/utils/result-guarantee.ts`. `guaranteeText()` and `buildFallbackResponse()`. Every tool can return a "what to do next" response when a fetch fails.
- Updated `server.instructions`. 14-tool descriptions, the trigger-phrase routing table, anti-patterns, and a reliability section so LLM clients pick the right tool first try.
- `--routing-table` CLI flag. Prints the routing table from the terminal.
- 4 new top-priority registry entries: `charmbracelet/bubbletea`, `open-webui/open-webui`, `google/adk-python`, `openai/openai-agents-python`.
- Verified `llms.txt` URLs on `expressjs/express`, `getsentry/sentry`, `anthropics/anthropic-sdk`.
- 64 new tests. intent-router (14), telemetry (10), dispatch (7), result-guarantee (9), IPv6 SSRF (14), Unicode bypass (11). Total: 1015 → 1083.

### Security (high severity fixes)
- C1. SSRF via `gt_get_docs` libraryId. `libraryId.includes(".")` previously hit `fetch(https://${libraryId})` without a public-URL check. Passing `169.254.169.254/...` could reach cloud metadata. Now gated by `assertPublicUrl()`.
- C2. IPv6 full-form bypass. `isBlockedIP()` only matched IPv6 shorthand. Full-form `0000:0000:0000:0000:0000:0000:0000:0001` (equal to `::1`) was passing through. The function now expands `::`, splits 8 hextets, and checks loopback, ULA, link-local, multicast, and IPv4-mapped recursively.
- H4 and H5. Unicode injection bypass. Added zero-width, RTL-override, and soft-hyphen stripping, plus NFKD normalization and an explicit homoglyph map (Latin small-caps, Cyrillic, Greek). `ɪɢɴᴏʀᴇ ᴘʀᴇᴠɪᴏᴜs` no longer slips past the injection patterns.
- H2. DiskCache non-atomic write. `writeFile` mid-process-kill produced corrupt JSON. Now writes to `${path}.${nonce}.tmp` and uses `rename()` atomically.
- H3. DiskCache concurrent-write race. Added a per-key `Map<string, Promise<void>>` lock so concurrent `set()` calls serialize.

### Reliability
- H1. `tryFetch` silent error swallow. Now logs structured WARN on rate-limit, exhausted retries, and SSRF block. Logs DEBUG on attempt failure, circuit-open, and too-short response. Operators can diagnose what's broken.
- `gt_migration` URL race. 7 migration URL suffixes were probed sequentially (35s worst case). Now `Promise.any()` in parallel. About 5s worst case.
- Telemetry on hot-path tools. `gt_dispatch`, `gt_resolve_library`, `gt_get_docs`, `gt_audit`, `gt_auto_scan`, and `gt_search` record success, resolve, and cacheHit per call.

### Data quality
- Registry ID cleanup. 11 entries had a placeholder owner `nicolo-ribaudo` (lucia, bcryptjs, web-vitals, pdf-lib, swiftui, puppeteer, react-pdf, node, nanoid, tauri, electron). All now use the real GitHub owner (lucia-auth, dcodeIO, GoogleChrome, Hopding, apple, puppeteer, diegomura, nodejs, ai, tauri-apps, electron).
- Tool annotations. All 14 tools set `idempotentHint: true`. Read-only documentation fetches are idempotent for a given input and time window. Clients can auto-retry on transient failures without re-prompting.
- REGISTRY_BADGE_SIZE: 444 → 445.

### Tool description quality
- Tool descriptions follow the six-component template from arXiv 2602.14878. Purpose, when to call, when not to call, limitations, parameters, examples.
- `gt_resolve_library`. Full Context7-style description with result fields, selection process, and a rate-limit note.
- `gt_migration`. Clarifies the "how to upgrade" vs `gt_changelog` "what changed" distinction.

### Internal
- New files: `src/tools/dispatch.ts`, `src/services/intent-router.ts`, `src/services/telemetry.ts`, `src/utils/result-guarantee.ts`.
- New tests: `intent-router.test.ts`, `telemetry.test.ts`, `dispatch.test.ts`, `result-guarantee.test.ts`, `fetcher.ipv6.test.ts`, `sanitize.unicode.test.ts`, `docs.ssrf.test.ts`.

---

## [6.1.3] — 2026-05-26

- fix(security): close CWE-23 path traversal in apply-enrichment.mjs
- ci(publish): never fail on missing npm auth — graceful skip + poll-retry idempotency

---

## [6.1.2] — 2026-05-26

- See diff for changes.

---

## [6.1.1] — 2026-05-26

- fix(security): block path traversal + XSS URL scheme bypasses

---

## [6.1.0] — 2026-05-26

**Release automation, CLI ergonomics, parallelism tuning.**

### Added
- `.github/workflows/publish.yml` — auto-publishes on tag push w/ npm provenance + Sigstore attestation. Also publishes to MCP Registry via `mcp-publisher` (GitHub OIDC).
- `--health` CLI flag — prints JSON health snapshot (name, version, installId, tools, registryEntries, node) and exits 0. For container probes and quick diagnostics.
- `--version` / `-v` CLI flag.
- `--help` / `-h` CLI flag — documents env vars and flags.
- `src/tools/schemas.test.ts` — snapshot tests for all 13 tool schemas; locks tool name set + input shape, catches accidental MCP contract drift.
- `publishConfig` in `package.json` — pins `access: public` + `provenance: true` so any `npm publish` invocation gets attestation.

### Changed
- `gt_auto_scan` default fan-out concurrency 4 → 8 (FetchSemaphore caps at 12; previous default left 8 slots idle).
- Hardened `scripts/update-stats.mjs` version sweep — now matches only `v6.0.0`, `"6.0.0"`, `` `6.0.0` ``, `@6.0.0`, `=6.0.0` patterns. Previous `replaceAll` matched any substring and corrupted CIDR comments (`172.16.0.0/12` → `172.16.1.0/12`).
- `.gitignore` — added `.npmrc`, credential files, `docs/private.bak-*/`.
- `package.json` repository URL → `git+https://...` form (npm provenance requirement).

### Fixed
- `src/services/fetcher.ts:62-68` — restored correct CIDR comments mangled by prior version sweep (`172.16.0.0/12`, `169.254.0.0/16`, `224.0.0.0/4`).

### Notes
- 996 tests pass across 34 files. Up from 990/33 in 6.0.0 (+6 from snapshot tests).
- 13 tools E2E smoke-tested via stdio MCP handshake — all 13 return non-empty content under 3s.
- npm audit 0 vulnerabilities.

---

## [6.0.0] — 2026-05-26

**Major upgrade — Context7 parity + surpass.**

### Added
- `gt_snippets` tool — Context7-compat structured code snippets with per-(library, version) persistent disk-cached index. First call indexes; subsequent calls instant.
- `src/utils/snippet-extract.ts` — markdown → structured `Snippet` records with title, description, language, code, source. BM25-scored ranking.
- `src/services/snippet-store.ts` — disk-cached snippet index, query API with language filter + topic-rank.
- Lockfile auto-version detection in `gt_get_docs` and `gt_snippets` — pass `projectPath` and the version is read from `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, `uv.lock`, or `go.sum`. Context7 needs manual `/repo@v` pinning.
- `poetry.lock`, `uv.lock`, `go.sum` parsers in `src/utils/lockfile.ts`.
- `contentHash` + `fetchedAt` exposed in `gt_get_docs` structured output (already stamped in `fetcher.ts`).
- 22 new registry entries: Google GenAI SDK, Genkit, Pydantic AI, Mastra, E2B, Langfuse, Helicone, DSPy, AutoGen, smolagents, Together AI, Groq, Cerebras, Replicate, fal.ai, Modal, Elysia, Encore, Trigger.dev, PocketBase, Appwrite, PGlite.
- `migration.test.ts` — closes the only test-coverage gap among tools.
- Stateless HTTP transport mode by default; `GT_HTTP_STATEFUL=1` opts into session-per-request.
- `headersTimeout`, `bodyTimeout`, `keepAliveTimeout`, `pipelining`, `connections` tuning on undici Agent.

### Changed
- `@modelcontextprotocol/sdk` 1.27.1 → 1.29.0 (PR #13 resolved).
- `undici` 7.24.7 → 8.3.0.
- `zod` 4.3.6 → 4.4.3.
- `vitest` 4.1.2 → 4.1.7. `@vitest/coverage-v8` matched.
- `@typescript-eslint/*` 8.58 → 8.60. `eslint` 10.1 → 10.4.
- `@types/node` 25.5 → 25.9. `tsx` 4.21 → 4.22. `javascript-obfuscator` 5.4.1 → 5.4.3.
- Node engine lowered `>=24` → `>=22`. `.node-version` 24.13.0 → 22.11.0. Removes the #1 adoption barrier.

### Fixed
- `registry.ts:718` Cloudflare Workers `bestPracticesPaths` were Vercel paths; replaced with `/workers/observability/`, `/workers/configuration/`, `/workers/platform/limits/`, `/workers/best-practices/`. `urlPatterns` likewise corrected.
- `registry.ts:733` ESLint `urlPatterns` were Cloudflare Workers paths; replaced with `/docs/latest/use/{slug}`, `/docs/latest/rules/{slug}`, `/docs/latest/extend/{slug}`, `/docs/latest/{slug}`.
- `registry.ts:746` Prettier `bestPracticesPaths` were Vercel paths; replaced with `/docs/en/options`, `/docs/en/configuration`, `/docs/en/integrating-with-linters`, `/docs/en/install`.

### Notes
- 970 tests pass across 31 test files.
- Tests: 962 pre-upgrade → 970 post (added 8 migration tests).
- Public registry: 421 → 442 entries.

---

## [5.2.0] — 2026-04-02

- chore: bump version to 5.1.0, update gitignore for research docs
- feat: intelligent search pipeline, content quality detection, fuzzy discovery
- fix(ci): regenerate lockfile for parser 8.58.0 resolution

---

## [5.1.0] — 2026-04-02

- feat: intelligent search pipeline, content quality detection, fuzzy discovery
- fix(ci): regenerate lockfile for parser 8.58.0 resolution

---

## [5.0.1] — 2026-04-01

- chore(deps): update @typescript-eslint/parser to 8.57.2
- chore(deps-dev): bump @vitest/coverage-v8 from 4.1.0 to 4.1.1
- chore(deps-dev): bump @typescript-eslint/eslint-plugin from 8.57.1 to 8.57.2
- chore(deps-dev): bump javascript-obfuscator from 5.3.0 to 5.4.1

---

## [5.0.0] — 2026-04-01

- See diff for changes.

---

## [4.0.0] — 2026-04-01

- test: add coverage for audit fixes (MAX_BREAKERS eviction, llmsProbeCache, withToolTimeout, GT_CACHE_DIR validation)
- fix: update resolve.test.ts mocks for llmsProbeCache and remove stale fetchViaJina references
- fix(audit): type-safety resolve.ts:58 - replace as unknown as LibraryMatch cast with typed llmsProbeCache
- fix(audit): perf resolve.ts:47 - concurrent probeLlmsTxt with Promise.allSettled (halves worst-case latency)
- fix(audit): security constants.ts:10 - block system directory paths for GT_CACHE_DIR to prevent cache write into /etc or /proc
- fix(audit): resource-leak circuit-breaker.ts:12 - evict oldest entry when breakers Map exceeds 500 to bound memory growth
- fix(audit): resource-leak guard.ts:117 - clear timeout in withToolTimeout to prevent 55s timer accumulation per tool call
- fix(audit): reliability index.ts - add SIGTERM/SIGINT graceful shutdown + unhandledRejection handler
- fix(audit): security index.ts:244 - add security headers + optional Bearer auth via GT_AUTH_TOKEN to HTTP transport
- fix(audit): validation index.ts:256 - validate GT_HTTP_PORT is a finite integer 1-65535, fail fast on invalid
- fix(audit): security index.ts:249 - remove server version from /health response to prevent version fingerprinting
- fix(audit): perf index.ts:102 - replace LIBRARY_REGISTRY.find() linear scan with O(1) lookupById()
- fix(audit): type-safety tsconfig.json - add noUnusedLocals, noUnusedParameters, types:[node]; remove dead fetchViaJina imports across 10 files
- fix(audit): supply-chain package.json:29 - replace git add -A with explicit file list to prevent staging unintended files on version bump
- fix(audit): supply-chain package.json - declare undici as explicit dependency (Node 24 built-in, not implicit)
- fix(audit): supply-chain package.json - override path-to-regexp to >=8.4.0 to resolve ReDoS CVE
- fix(audit): ci add security.yml -- dependency audit + typecheck + test on every PR

---

## [3.5.0] — 2026-03-27

- feat: add 24 website/SEO/web-dev topic entries for full coverage
- feat: add 24 Google ecosystem topic URL map entries
- fix: prevent 529 overloaded errors with concurrency limits and tool timeouts

---

## [3.4.0] — 2026-03-27

- fix: 404 page detection, indexing pattern, docs llms.txt fallback, new topics

---

## [3.3.0] — 2026-03-26

- fix: word-boundary matching for short patterns + new topic entries

---

## [3.2.0] — 2026-03-26

- fix: detect Gatsby HTML blobs + add React/Next.js topic patterns
- fix: HTML blob detection, Accept-Language header, search URL gate

---

## [3.1.0] — 2026-03-26

- fix: undici DNS callback format + SSRF bypass for high-byte IP ranges

---

## [3.0.7] — 2026-03-26

- feat: universal dynamic resolution for all tools
- fix: patch picomatch high severity vulnerability (ReDoS + method injection)

---

## [3.0.6] — 2026-03-26

- See diff for changes.

---

## [3.0.5] — 2026-03-26

- chore: bump to 3.0.4, update changelog with reliability overhaul
- fix: synthetic section generation for headingless content and minor type fixes
- fix: eliminate Jina Reader single point of failure with HTML-to-Markdown fallback
- chore(deps): bump actions/setup-node from 4.4.0 to 6.3.0
- chore(deps-dev): bump eslint from 9.39.4 to 10.1.0
- chore(deps): bump actions/checkout from 4.2.2 to 6.0.2
- chore(deps): bump actions/upload-artifact from 4.6.2 to 7.0.0

---

## [3.0.4] — 2026-03-26

### Reliability overhaul — eliminate Jina Reader single point of failure

Every tool previously depended on Jina Reader as the sole content extraction path. When Jina was rate-limited (429), slow, or down, all tools failed. This release adds a parallel HTML-to-Markdown extraction path so content fetching works even without Jina.

### New

- **`src/utils/html-to-md.ts`** — lightweight HTML-to-Markdown converter (no external deps). Extracts `<main>`/`<article>` content areas, strips nav/footer/sidebar/scripts, converts headings, code blocks with language detection, links, lists, tables, bold/italic, blockquotes, definition lists. Decodes HTML entities, collapses whitespace.
- **`fetchAsMarkdown(url)`** — tries direct HTML fetch + extraction first (fast, no Jina dependency), falls back to Jina Reader for JS-rendered pages.
- **`fetchAsMarkdownRace(url)`** — races both paths via `Promise.any()`, first good result wins. Includes cache layer and in-flight deduplication.

### Changed

- **`fetchDocs` fallback chain** — now has 3 independent paths: llms.txt discovery, direct HTML extraction, Jina Reader (was only llms.txt + Jina).
- **All 10 tools** updated to use `fetchAsMarkdownRace` instead of `fetchViaJina` for content fetching: `gt_get_docs`, `gt_best_practices`, `gt_search`, `gt_audit`, `gt_changelog`, `gt_compare`, `gt_compat`, `gt_migration`, `gt_auto_scan`, `gt_resolve_library`.
- **`raceUrls()` in best-practices** — uses `fetchAsMarkdownRace` instead of only Jina, so curated BP URL fetching works when Jina is down.
- **`fetchTopicContent()` in search** — uses `fetchAsMarkdownRace` for all topic URL fetching.
- **`deepFetchForTopic()` pipeline** — all page fetching uses `fetchAsMarkdownRace`.
- **`DEEP_FETCH_RELEVANCE_THRESHOLD`** lowered from 0.5 to 0.3 — triggers deeper fetching more often when initial content is off-topic.
- **Synthetic section generation** in `extract.ts` — content without markdown headings (common with direct HTML extraction) gets split into paragraph-based sections for BM25 scoring.

### Dependencies

- `eslint` bumped from 9.39.4 to 10.1.0
- `actions/checkout` bumped from 4.2.2 to 6.0.2
- `actions/upload-artifact` bumped from 4.6.2 to 7.0.0
- `actions/setup-node` bumped from 4.4.0 to 6.3.0

### Stats

- 770 tests across 26 files (up from 758 across 25)
- 12 new tests for HTML-to-Markdown converter
- All existing tests updated for new fetch path

---

## [3.0.3] — 2026-03-22

- fix: correct test count badge to 758
- feat: add mobile audit patterns, fix ws_ naming, fix duplicate aliases

---

## [3.0.2] — 2026-03-21

- fix: improve audit tool descriptions for broad queries
- docs: update DOCUMENTATION.md to match v3.0.0
- docs: trim README, move detailed content to DOCUMENTATION.md

---

## [3.0.1] — 2026-03-21

- See diff for changes.

---

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
