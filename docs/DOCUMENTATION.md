# GroundTruth — Full Technical Documentation

> Everything you need to know about how GroundTruth works, what each tool does, and how the internals fit together.

---

## Table of Contents

- [Architecture](#architecture)
- [Tools — Complete Reference](#tools--complete-reference)
  - [gt_resolve_library](#gt_resolve_library)
  - [gt_get_docs](#gt_get_docs)
  - [gt_best_practices](#gt_best_practices)
  - [gt_auto_scan](#gt_auto_scan)
  - [gt_search](#gt_search)
  - [gt_audit](#gt_audit)
  - [gt_changelog](#gt_changelog)
  - [gt_compat](#gt_compat)
  - [gt_compare](#gt_compare)
  - [gt_examples](#gt_examples)
  - [gt_migration](#gt_migration)
  - [gt_batch_resolve](#gt_batch_resolve)
- [Documentation Fetch Pipeline](#documentation-fetch-pipeline)
- [Registry System](#registry-system)
- [Library Coverage](#library-coverage)
- [Caching](#caching)
- [Content Processing](#content-processing)
- [Security](#security)
- [Build Pipeline](#build-pipeline)
- [Testing](#testing)
- [MCP Resources](#mcp-resources)
- [MCP Prompts](#mcp-prompts)
- [Environment Variables](#environment-variables)
- [CI/CD](#cicd)

---

## Architecture

```
src/
  index.ts              — Entry point, MCP server bootstrap, stdio transport
  constants.ts          — SERVER_NAME, SERVER_VERSION, URL constants, INJECTION_PATTERNS
  types.ts              — Shared TypeScript types (LibraryEntry, LibraryMatch, FetchResult, etc.)
  tools/                — One file per MCP tool (12 tools)
    resolve.ts          — gt_resolve_library (registry + npm/PyPI/crates.io/Go fallback)
    docs.ts             — gt_get_docs (live documentation fetch)
    best-practices.ts   — gt_best_practices (422+ curated best-practices URL map)
    auto-scan.ts        — gt_auto_scan (manifest parsing + lockfile detection)
    search.ts           — gt_search (1598+ curated topic-URL entries)
    audit.ts            — gt_audit (100+ file-level audit patterns)
    changelog.ts        — gt_changelog (GitHub Releases + CHANGELOG.md)
    compat.ts           — gt_compat (MDN + caniuse browser support)
    compare.ts          — gt_compare (side-by-side library comparison)
    examples.ts         — gt_examples (GitHub Code Search)
    migration.ts        — gt_migration (migration guides + breaking changes)
    batch-resolve.ts    — gt_batch_resolve (resolve up to 20 libraries at once)
  sources/
    registry.ts         — LIBRARY_REGISTRY (422+ entries with docs URLs, aliases, tags)
  services/
    fetcher.ts          — HTTP fetching, Jina Reader, GitHub API, npm/PyPI queries
    cache.ts            — LRU memory cache (200 entries) + persistent disk cache
    deep-fetch.ts       — Multi-page content assembly, deep link following
    circuit-breaker.ts  — Per-domain failure isolation
  utils/
    extract.ts          — BM25 keyword scoring, section parsing, content trimming
    guard.ts            — Path traversal prevention, SSRF blocking, extraction detection
    sanitize.ts         — Prompt injection pattern removal, nav/footer stripping
    watermark.ts        — Invisible Unicode watermarking for provenance tracking
    lockfile.ts         — Lockfile version detection (package-lock, pnpm, yarn, Cargo)
    quality.ts          — 0-1 content quality scoring per response
    version-check.ts    — npm update check on startup
```

The server bootstraps via `index.ts`, registers all 12 tools, 2 resources, and 8 prompts with the MCP SDK, then connects to stdio transport. Every tool validates input with Zod, checks for extraction attempts, fetches content, sanitizes it, and returns it with an IP notice watermark.

---

## Tools — Complete Reference

### gt_resolve_library

Resolves a library name to a registry ID, docs URL, and metadata. Call this first before using gt_get_docs or gt_best_practices.

**Resolution chain (stops at first match):**
1. Exact alias match in the curated registry
2. Fuzzy search across registry names, aliases, and tags
3. npm registry lookup (extracts homepage, probes for llms.txt/llms-full.txt)
4. PyPI registry lookup (extracts homepage, probes for llms.txt)
5. crates.io API lookup (Rust crates)
6. pkg.go.dev lookup via Jina Reader (Go modules)

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `libraryName` | string | yes | Library name, e.g. "nextjs", "react", "fastapi", "tokio" |
| `query` | string | no | What you want to do with it — used to rank results |

**Output:** Up to 5 matches with `id`, `name`, `description`, `docsUrl`, `llmsTxtUrl`, `llmsFullTxtUrl`, `githubUrl`, `score`, `source`.

---

### gt_get_docs

Fetches live documentation for a library, filtered by topic. Supports version-specific docs.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `libraryId` | string | yes | ID from gt_resolve_library, or a docs URL, or `npm:package` / `pypi:package` |
| `topic` | string | no | What to learn: "routing", "authentication", "middleware" |
| `version` | string | no | Version filter: "14", "3.0.3", "v2" |
| `tokens` | number | no | Max tokens to return (default: 8000, max: 20000) |

**How it resolves the library:**
1. Direct registry ID lookup
2. Alias lookup
3. URL starting with `http://` or `https://` — used as docs URL directly
4. `npm:` prefix — fetches from npm registry
5. `pypi:` prefix — fetches from PyPI
6. Contains a dot — treated as a URL
7. Fallback — tries npm then PyPI

**Content pipeline:** fetch -> sanitize (strip injection patterns, nav/footer) -> BM25 rank sections by topic relevance -> trim to token limit.

---

### gt_best_practices

Fetches patterns, anti-patterns, configuration guidance, and migration notes for any library.

**Input:** Same as gt_get_docs (`libraryId`, `topic`, `version`, `tokens`).

**Fetch strategy (4-step fallback):**
1. Curated best-practices URLs from the internal map (422+ libraries with hand-picked guide pages)
2. Generic best-practices URL patterns (e.g. `{docsUrl}/best-practices`, `{docsUrl}/guides`)
3. Primary docs fetch (llms.txt -> Jina -> GitHub README)
4. GitHub examples fetch (CHANGELOG.md, MIGRATION.md, docs/best-practices.md)

Each step includes index-content detection — if the fetched page is just a table of contents (>50% markdown links), it follows the most relevant deep links.

---

### gt_auto_scan

Reads your project's dependency manifests, detects installed versions from lockfiles, and fetches best practices for every dependency in one call.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectPath` | string | no | Path to project root (defaults to cwd) |
| `topic` | string | no | Focus area (default: "latest best practices") |
| `tokensPerLib` | number | no | Max tokens per library result |

**Supported manifests:**
- `package.json` (Node.js — dependencies, devDependencies, peerDependencies)
- `requirements.txt` (Python pip)
- `pyproject.toml` (Poetry, PDM, Hatch, Rye, uv, PEP 621)
- `Pipfile` (pipenv)
- `Cargo.toml` (Rust)
- `go.mod` (Go)
- `pom.xml` (Maven)
- `build.gradle` / `build.gradle.kts` (Gradle)
- `composer.json` (PHP)
- `Gemfile` (Ruby)
- `deno.json` (Deno)
- `pubspec.yaml` (Dart/Flutter)

**Lockfile version detection:**
- `package-lock.json` (npm v2/v3 lockfileVersion)
- `pnpm-lock.yaml`
- `yarn.lock`
- `Cargo.lock`

Detected versions are included in the fetch query (e.g. "v19.1.0 best practices") for more targeted results.

**Concurrency:** Configurable via `GT_CONCURRENCY` env var (default: 6). Caps at 20 libraries per scan.

---

### gt_search

Freeform search across web standards, security guidelines, AI provider docs, and more. Not tied to a specific library.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | What to search for |
| `tokens` | number | no | Max tokens (default: 8000, max: 20000) |

**Search strategy (4-step):**
1. Curated topic-URL map (1598+ entries mapped to authoritative source URLs)
2. DuckDuckGo search for broader queries
3. devdocs.io fallback (200+ technologies)
4. Jina Reader on the best search result

**Covered topic areas:**

| Area | Topics |
|---|---|
| Security | OWASP Top 10, SQL injection, XSS/CSP, CSRF, HSTS, JWT, OAuth 2.1, OIDC, WebAuthn, SSRF, API security, supply chain |
| Accessibility | WCAG 2.2, WAI-ARIA, keyboard navigation |
| Performance | Core Web Vitals (INP, not FID), image optimization, Speculation Rules |
| Web APIs | Fetch, Workers, WebSocket, WebRTC, IndexedDB, Web Crypto, WebAssembly, AbortController |
| CSS | Grid, Flexbox, Container Queries, View Transitions, Cascade Layers, :has(), Subgrid, @scope |
| HTTP | Headers, caching, HTTP/2, HTTP/3, REST, OpenAPI, GraphQL, gRPC, SSE, JSON Schema |
| Google APIs | Gemini, Maps, Analytics 4, Ads, Search Console, Sheets, Drive, Calendar, OAuth, GTM, reCAPTCHA, YouTube, Gmail, Chrome Extensions, Fonts |
| Google Cloud | Cloud Run, Functions, Storage, BigQuery, Pub/Sub, Vertex AI, Vision, Speech, GKE, IAM |
| Firebase | Firestore, Authentication, Cloud Functions, Hosting |
| AI/LLM | Claude API, OpenAI API, Gemini API, Mistral, Cohere, Groq, LangChain, LlamaIndex, CrewAI, AutoGen, RAG, prompt engineering, agents, embeddings |
| Infrastructure | Docker, Kubernetes, GitHub Actions, Terraform, Cloudflare Workers, monorepos |
| Databases | PostgreSQL, Redis, MongoDB |
| Languages | Rust, Go, Python, Node.js, TypeScript |

---

### gt_audit

Scans project source files for real issues at exact `file:line` locations, then fetches current fix guidance from authoritative sources.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectPath` | string | no | Path to scan (defaults to cwd) |
| `categories` | string[] | no | Which categories to check (default: all) |
| `maxFiles` | number | no | Max files to scan (1-200, default: 50) |
| `tokens` | number | no | Max tokens per fix fetch (default: 4000) |

**How it works:**
1. Walks the project tree, reads `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html`, `.py` files
2. Builds a comment map — identifies commented-out lines (both `//` and `#`) and skips them
3. Skips test files, generated files, `node_modules`, `.next`, `dist`
4. Runs 100+ regex patterns across 18 categories
5. Groups findings by issue type, counts occurrences
6. For the top unique issue types, fetches current fix guidance from OWASP, MDN, react.dev, web.dev, or the relevant spec
7. Reports each finding with file path, line number, severity, and a concrete fix

**Categories and pattern counts:**

| Category | Patterns | Source |
|---|---|---|
| `layout` | 6 | web.dev CLS guidelines |
| `performance` | 7 | web.dev Core Web Vitals |
| `accessibility` | 10 | WCAG 2.2, WAI-ARIA |
| `security` | 11 | OWASP Top 10, OWASP Cheat Sheets |
| `react` | 7 | react.dev/reference/rules |
| `nextjs` | 6 | Next.js 16 migration guide |
| `typescript` | 7 | typescript-eslint recommended rules |
| `node` | 5 | Node.js best practices |
| `python` | 11 | OWASP Python Security Cheat Sheet |

**Severity levels:** critical, high, medium, low. Security patterns default to critical. Layout patterns default to medium.

**Sample output:**

```
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

### gt_changelog

Fetches release notes for any library. Useful before upgrading.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `libraryId` | string | yes | Library ID from gt_resolve_library |
| `version` | string | no | Filter to a specific version |
| `tokens` | number | no | Max tokens (default: 8000) |

**Fetch strategy:**
1. GitHub Releases API (latest 3 non-prerelease)
2. CHANGELOG.md from GitHub repo (main/master branch)
3. Docs site changelog page via Jina Reader

When `version` is specified, content is filtered to only the section matching that version string.

---

### gt_compat

Checks browser and runtime compatibility for web APIs, CSS features, and JavaScript syntax.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feature` | string | yes | Feature to check, e.g. "CSS container queries", "Array.at()" |
| `environments` | string[] | no | Filter to specific browsers/runtimes |
| `tokens` | number | no | Max tokens (default: 8000) |

**Data sources:** MDN Web Docs (via Jina Reader) and caniuse.com (via Jina Reader). Results are merged and deduplicated.

---

### gt_compare

Side-by-side comparison of 2-3 libraries.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `libraries` | string[] | yes | 2-3 library names to compare |
| `criteria` | string | no | What to compare on: "performance", "TypeScript support", "bundle size" |
| `tokens` | number | no | Max tokens per library (default: 8000) |

Fetches live docs for each library (same pipeline as gt_get_docs), filters to content relevant to the criteria, and returns them side by side.

---

### gt_examples

Searches GitHub for real-world code examples of a library or pattern.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `library` | string | yes | Library name, e.g. "drizzle-orm", "fastapi" |
| `pattern` | string | no | Specific pattern to search for: "middleware", "useMutation" |
| `language` | string | no | Language filter: "typescript", "python", "rust", "go" |
| `maxResults` | number | no | 1-10, default 5 |

**How it works:**
- Uses GitHub Code Search API (`GET /search/code`)
- Requests text matches via `Accept: application/vnd.github.text-match+json`
- Excludes test files, `node_modules`, `.next`, spec files
- Returns code snippets with repository name, star count, file path, and direct link
- Caches results for 1 hour

**Rate limits:** GitHub Code Search allows 10 requests/minute. Setting `GT_GITHUB_TOKEN` raises the general API limit to 5000 req/hr but code search stays at 10/min.

---

### gt_migration

Fetches migration guides, breaking changes, and upgrade instructions for a library.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `libraryId` | string | yes | Library ID from gt_resolve_library |
| `fromVersion` | string | no | Version migrating from |
| `toVersion` | string | no | Version migrating to |
| `tokens` | number | no | Max tokens (default: 8000) |

**Fetch strategy:**
1. MIGRATION.md / UPGRADE.md from GitHub repo
2. Docs site migration guide pages
3. GitHub Releases filtered by version range
4. CHANGELOG.md filtered to relevant versions

---

### gt_batch_resolve

Resolves multiple library names in a single call. Useful for scanning a dependency list.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `libraryNames` | string[] | yes | Up to 20 library names to resolve |

Returns an array of resolution results, one per library name. Same resolution chain as gt_resolve_library.

---

## Documentation Fetch Pipeline

Every docs request goes through this pipeline:

```
Request -> Input Validation (Zod) -> Extraction Guard -> Fetch -> Sanitize -> Extract -> Watermark -> Response
```

### Fetch order (stops at first success):
1. **llms-full.txt** — the richest LLM-optimized content when available
2. **llms.txt** — shorter LLM-optimized content
3. **Auto-discovery** — probes the domain root for `/llms.txt` even if not in the registry
4. **Jina Reader** — converts any URL to clean markdown, handles JS-rendered pages
5. **GitHub README** — raw content from main/master branch
6. **Direct fetch** — plain HTTP GET as last resort

### Deep multi-page fetch
When a single page doesn't contain enough relevant content, the deep-fetch pipeline follows links to assemble content from multiple pages. Uses `urlPatterns` from the registry to construct topic-specific URLs with `{slug}` placeholders replaced by the query topic.

### Stale-while-revalidate
Cached content is served immediately while a background refresh runs. Stale window: 60 minutes beyond the 30-minute TTL. Keeps responses fast even when upstream is slow.

### Circuit breaker
Per-domain failure isolation. After 5 consecutive failures to a domain, that domain is marked "open" and requests fail fast for 30 seconds before retrying. Prevents one slow docs site from blocking all requests.

### Content integrity
Every fetched document gets a SHA-256 content hash (16-char prefix) and ISO timestamp. These are returned in `structuredContent` and can be used to detect content changes across sessions.

### Content quality scoring
Each response includes a 0-1 quality score based on content length, topic relevance, and source type. Low-quality scores signal the model to retry with different parameters.

---

## Registry System

The registry is a curated array of `LibraryEntry` objects:

```typescript
interface LibraryEntry {
  id: string;                     // e.g. "vercel/next.js"
  name: string;                   // e.g. "Next.js"
  aliases: string[];              // e.g. ["nextjs", "next"]
  description: string;
  docsUrl: string;                // primary documentation URL
  llmsTxtUrl?: string;            // llms.txt URL if known
  llmsFullTxtUrl?: string;        // llms-full.txt URL if known
  githubUrl?: string;
  npmPackage?: string;
  pypiPackage?: string;
  language: string[];             // e.g. ["typescript", "javascript"]
  tags: string[];                 // e.g. ["framework", "react", "ssr"]
  bestPracticesPaths?: string[];  // specific docs paths for best practices
  urlPatterns?: string[];         // URL patterns with {slug} for topic-based fetching
}
```

**Lookup methods:**
- `lookupById(id)` — exact ID match
- `lookupByAlias(name)` — checks `id`, `name`, all `aliases`, `npmPackage`, `pypiPackage`
- `fuzzySearch(query, limit)` — scores entries by matching query tokens against name, aliases, description, and tags

**Coverage:** 422+ curated entries with 100% bestPracticesPaths and urlPatterns coverage. Any public package not in the registry is resolved via npm, PyPI, crates.io, or pkg.go.dev fallback.

---

## Library Coverage

422+ curated entries across every major ecosystem. Full best-practices and URL pattern coverage on all entries.

| Ecosystem | Libraries |
|---|---|
| React / Next.js | React, Next.js, shadcn/ui, Radix UI, Radix Themes, Tailwind CSS, Headless UI, Ariakit, Zag.js, Panda CSS |
| State management | Zustand, Jotai, TanStack Query, SWR, Redux Toolkit, Valtio, MobX, XState, Pinia |
| Backend (Node.js) | Express, Fastify, Hono, NestJS, Elysia, Nitro, tRPC |
| Backend (Python) | FastAPI, Django, Flask, Pydantic |
| Backend (Go) | Gin, Fiber, GORM, chi |
| Backend (Rust) | Axum, Actix Web, sqlx, Tokio |
| Backend (Java) | Quarkus, Micronaut, JUnit 5 |
| Database / ORM | Prisma, Drizzle, Kysely, TypeORM, Mongoose, Knex, Supabase, Neon, Turso, Electric SQL, SurrealDB, ScyllaDB, TimescaleDB |
| Vector databases | Pinecone, Chroma, Weaviate, Qdrant |
| AI / LLM providers | Anthropic Claude API, OpenAI API, Google Gemini API, Mistral AI, Cohere, Groq, Replicate, Together AI, Fireworks AI |
| AI SDKs (JS/TS) | Vercel AI SDK, Anthropic SDK, OpenAI SDK, Google Generative AI, LangChain.js, Transformers.js, Ollama, assistant-ui |
| AI SDKs (Python) | Anthropic Python SDK, OpenAI Python SDK, Google Gemini Python SDK, LangChain, LlamaIndex, CrewAI, LangGraph, AutoGen, HuggingFace Transformers, Instructor |
| AI agents | Claude Code, Claude Agent SDK, OpenAI Agents SDK |
| AI audio / voice | ElevenLabs, Deepgram, AssemblyAI |
| AI image / video | Stability AI, fal.ai, HuggingFace Diffusers |
| Google | Firebase, Google Cloud, Google Maps API, Google APIs Client, Vertex AI, Angular, Flutter, Material Design |
| Testing | Vitest, Playwright, Jest, Testing Library, Cypress, MSW, Maestro |
| Auth | Clerk, NextAuth, Better Auth, Lucia, Passport.js |
| Validation | Zod, Yup, Valibot, Effect |
| Rich text | Tiptap, Lexical, CodeMirror, Slate.js |
| Content | MDX, unified, Contentlayer, Fumadocs, gray-matter |
| CMS | Payload CMS, Strapi, Contentful, WordPress |
| Email | Resend, Nodemailer, SendGrid |
| Payments | Stripe |
| Mobile | Expo, React Native, React Navigation, NativeWind, Reanimated, MMKV, FlashList, Skia, Moti |
| Build tools | Vite, Turbopack, SWC, Rollup, Webpack, Biome, ESLint, Prettier, Turborepo, Nx, Semgrep |
| Runtime | Node.js, Bun, Deno |
| Cloud | Vercel, Cloudflare Workers, AWS SDK, Firebase, Google Cloud, Fly.io, Azure SDK |
| Monitoring | Sentry, PostHog, OpenTelemetry, Pino, Umami |
| Automation | n8n, Trigger.dev, DVC |
| HTTP clients | Axios, ky, ioredis |
| Real-time | Socket.IO, PartyKit, NATS |
| GraphQL | Apollo Client, urql, GraphQL.js |
| ML / Deep learning | PyTorch, TensorFlow, HuggingFace Transformers, scikit-learn, Matplotlib |
| Python tools | Beautiful Soup, Black, mypy, Rich |
| Serverless | Upstash Redis |
| Infrastructure | Docker, Kubernetes, ArgoCD, Istio, Terraform |
| Web standards | MDN (Fetch, Workers, WebSocket, WebRTC, IndexedDB, Web Crypto, CSS Grid, Flexbox, Container Queries, HTTP Headers, CORS) |
| Security standards | OWASP Top 10, OWASP Cheat Sheets (SQLi, XSS, Auth, Session, CSP), HSTS |
| Auth standards | OAuth 2.1, JWT, OpenID Connect, WebAuthn / Passkeys |
| Accessibility | WCAG 2.2, WAI-ARIA APG |
| Performance | Core Web Vitals, web.dev |
| Specifications | OpenAPI, GraphQL Spec, Rust Book, Python docs, Go docs, Swagger |
| Frontend | Alpine.js, Lit, Bevy, React Three Fiber, React Three Drei, templ |
| Elixir | Ecto |

Plus automatic fallback to npm, PyPI, crates.io, and pkg.go.dev for any public package not in the list.

---

## Caching

### Memory cache (LRU)
- `docCache`: 200 entries, 30-minute TTL
- `resolveCache`: 500 entries, 30-minute TTL
- LRU eviction when full

### Disk cache
- Location: `~/.gt-mcp-cache` (configurable via `GT_CACHE_DIR`)
- Keys are SHA-256 hashed to filenames
- Each entry is a JSON file with `{ data, expiresAt }` metadata
- 30-minute TTL by default, 1 hour for GitHub releases and examples
- Survives across npx invocations and process restarts
- I/O errors are silently ignored (cache miss, not crash)

### Stale-while-revalidate
Stale entries within the 60-minute SWR window are served immediately while a background fetch refreshes the cache. Prevents latency spikes from cold cache hits.

### In-flight deduplication
Concurrent requests for the same URL are deduplicated. Only one fetch runs; all waiters get the same result.

---

## Content Processing

### Sanitization (`sanitize.ts`)
Strips 40+ patterns from fetched content:
- Prompt injection attempts (from `INJECTION_PATTERNS` in constants.ts)
- Navigation/footer boilerplate from Jina Reader output
- "Skip to content" links, breadcrumbs, "Edit on GitHub" links
- Previous/Next page navigation, sidebar navigation
- Social sharing links, cookie notices, newsletter signup blocks
- `<script>` and `<style>` tags

### Extraction (`extract.ts`)
- Parses content into sections by heading
- BM25 keyword scoring ranks sections by relevance to the query topic
- Top-scoring sections are assembled and trimmed to the token limit
- Default: 8000 tokens (~30,400 characters at 3.8 chars/token)
- Maximum: 20,000 tokens

### Index content detection
If fetched content looks like a table of contents (>50% of lines are markdown links), it follows the most relevant deep links instead of returning the index.

---

## Security

### Prompt injection guard
`INJECTION_PATTERNS` in `constants.ts` catches 15+ patterns:
- "ignore previous instructions"
- "you must now" / "you should now"
- `SYSTEM:` / `ASSISTANT:` prefixes
- JAILBREAK / DAN patterns
- HTML comment injection
- Unicode direction override characters
- "act as" / "pretend to be" reframing
- "from now on" instruction overrides
- ChatML / special token delimiters
- Markdown image exfiltration attempts
- Tool/function override attempts

All fetched external content is run through these patterns before returning to the model.

### Path traversal prevention
`safeguardPath()` blocks access to `/etc`, `/proc`, `/sys`, `/dev`, `/boot`, `/root`, `/var/run`, `/run`.

### SSRF prevention
`assertPublicUrl()` blocks requests to private/internal IP ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.255.1.0/16`, localhost, `::1`, link-local IPv6, ULA IPv6.

### Extraction protection
Queries that look like bulk enumeration attempts ("list all libraries", "dump everything", "export registry") are refused with a license notice.

### Watermarking
Every response is embedded with an invisible cryptographic watermark (64 Unicode mathematical operators, U+2061/U+2062) encoding the installation ID and a per-request nonce. Survives copy-paste. Used for forensic provenance tracking.

---

## Build Pipeline

Two-stage build:

1. **TypeScript compile** — `tsc` outputs to `dist/`
2. **Obfuscation** — `javascript-obfuscator` runs over `dist/` with RC4 string encoding, 90% string array threshold, and 10-char string splitting

```bash
npm run build          # tsc + obfuscate
npm run build:publish  # swap private registry, build, revert (used by prepublishOnly)
npm run dev            # tsx watch (no obfuscation, fast reload)
npm run start          # node dist/index.js (obfuscated)
```

---

## Testing

762 tests across 25 files. Test runner: Vitest 4.x with `forks` pool (avoids ESM shared-state issues).

| Test file | What it covers |
|---|---|
| `registry.test.ts` | Registry integrity, lookupById, lookupByAlias, fuzzySearch, bestPracticesPaths/urlPatterns coverage, alias uniqueness |
| `audit.test.ts` | buildCommentMap, all 100+ audit patterns across 18 categories |
| `audit-handler.test.ts` | Audit tool handler: input validation, file scanning, category filtering |
| `auto-scan.test.ts` | All manifest parsers using temp directories |
| `auto-scan-handler.test.ts` | Handler: lockfile integration, concurrency, path validation |
| `resolve.test.ts` | All 6 resolution fallbacks, llms.txt probing, query scoring |
| `docs.test.ts` | All URL resolution paths, version fetch, index content follow |
| `best-practices.test.ts` | 4-step fallback chain, bestPracticesPaths map |
| `search.test.ts` | Topic matching, DuckDuckGo fallback, devdocs.io |
| `examples.test.ts` | GitHub Code Search, caching, rate limits, auth headers |
| `changelog.test.ts` | GitHub Releases, CHANGELOG.md fallback, version filtering |
| `compat.test.ts` | MDN + caniuse fetch, environment filtering |
| `compare.test.ts` | 2-3 library comparison, deep link follow |
| `fetcher.test.ts` | fetchWithTimeout, fetchViaJina, fetchDocs (all paths), hashContent, isIndexContent, rankIndexLinks, fetchDevDocs, GitHub API |
| `cache.test.ts` | LRU eviction, TTL expiry, disk persistence, I/O error handling |
| `extract.test.ts` | BM25 scoring, section parsing, truncation |
| `sanitize.test.ts` | Injection stripping, nav/footer removal |
| `guard.test.ts` | safeguardPath, assertPublicUrl, isExtractionAttempt |
| `watermark.test.ts` | Watermark embedding and extraction |
| `lockfile.test.ts` | Lockfile version detection for package-lock, pnpm-lock, yarn.lock, Cargo.lock |
| `version-check.test.ts` | Version comparison, update notifications |
| `index.test.ts` | Server bootstrap, all 12 tool registrations, 2 resources, 8 prompts |

---

## MCP Resources

Two browsable resources registered with the MCP SDK:

| Resource | URI | Description |
|---|---|---|
| Library Registry | `gt://registry` | JSON array of all registry entries with `id`, `name`, `docsUrl` |
| Library Docs | `gt://docs/{libraryId}` | Fetch documentation for a library by its registry ID |

---

## MCP Prompts

Eight discoverable prompts registered as slash commands in compatible MCP clients:

| Prompt | Arguments | What it triggers |
|---|---|---|
| `audit-my-project` | — | Full gt_audit scan with all categories |
| `upgrade-check` | `library` | gt_changelog for the specified library |
| `best-practices-scan` | — | gt_auto_scan for all project dependencies |
| `compare-libraries` | `libraries` (comma-separated) | gt_compare side-by-side |
| `security-check` | `topic` | gt_search with OWASP focus |
| `migration-guide` | `library`, `fromVersion?`, `toVersion?` | gt_changelog + gt_get_docs for migration steps |
| `find-examples` | `library`, `pattern` | gt_examples for real-world usage |
| `check-compatibility` | `feature` | gt_compat for browser support |

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GT_GITHUB_TOKEN` | GitHub API auth — raises limit from 60 to 5,000 req/hr | none |
| `GT_CACHE_DIR` | Disk cache directory path | `~/.gt-mcp-cache` |
| `GT_CONCURRENCY` | Parallel fetch limit in gt_auto_scan | `6` |

---

## CI/CD

GitHub Actions pipeline runs on every push and PR to `main`:

| Job | What it does |
|---|---|
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run --coverage`, uploads coverage artifact |
| `build` | `tsc + obfuscator + npm audit`, uploads dist artifact |

Build job depends on both typecheck and test passing. Action SHAs are pinned for supply chain integrity. Node.js 24 throughout.

---

## Version Sync

`SERVER_VERSION` in `src/constants.ts` must always match `version` in `package.json`. The `version` npm lifecycle script handles this automatically when you run `npm version X.Y.Z`.

---

## Publishing

```bash
npm version patch    # bumps version, syncs constants.ts, updates changelog
npm publish --access public   # prepublishOnly runs clean + build:publish + update-stats
```

The `prepublishOnly` script swaps the private registry into `src/`, builds with the full 422+ entries, obfuscates, then reverts `src/` to the public registry. The `postversion` script pushes tags and creates a GitHub release.
