# Changelog

## [1.9.0] — 2026-03-18

### Added

**Complete test coverage — 402 tests across 15 files** — every module now has dedicated tests with no gaps.

New test files:

- `src/index.test.ts` — bootstrap: McpServer instantiation (name, version, instructions), all 6 tool registration calls verified with the server instance, StdioServerTransport creation, constants validation
- `src/services/fetcher.test.ts` — fetchDocs (llms-full, llms-txt, direct, Jina fallback, cache), fetchViaJina, fetchGitHubContent, fetchGitHubExamples (14-path concurrency, cache), fetchGitHubReleases (.git suffix stripping), fetchNpmPackage, fetchPypiPackage — 60+ cases
- `src/tools/docs.test.ts` — ws_get_docs: registry lookup, URL resolution (http/https/npm:/pypi:/dot-notation), GitHub README fallback, response building, display-name extraction
- `src/tools/best-practices.test.ts` — ws_best_practices: extraction guard, known BP URL race, fetchDocs fallback, full GitHub fallback chain, structuredContent fields
- `src/tools/auto-scan-handler.test.ts` — ws_auto_scan: extraction guard, no-manifest message, package.json/requirements.txt scanning, SKIP_DEPS filtering, deduplication, cap at 20 libs
- `src/tools/resolve.test.ts` — ws_resolve_library: extraction guard, ID/alias/fuzzy matching, language/tag filtering, structuredContent schema
- `src/tools/search.test.ts` — ws_search: extraction guard, URL-map lookup, fetchDocs success/failure, response format

### Fixed

- `src/index.test.ts`: McpServer mock uses `function` keyword (not arrow) so `new McpServer()` is constructable; `vi.hoisted()` spy on `process.exit` prevents vitest from catching the async `.catch` handler as an unhandled error
- `src/services/fetcher.test.ts`: `.not.toContain("repo.git")` (api.github.com itself contains `.git`); fetchGitHubExamples cache test asserts 14 calls (7 paths × 2 branches); npm/PyPI payloads exceed the 100-char `tryFetch` minimum

---

## [1.8.0] — 2026-03-18

### Changed

**All GitHub Actions upgraded to Node.js 24 native runtimes** — eliminates the "Node.js 20 actions are deprecated" warning entirely:

- `actions/checkout` → v6.0.2 (`de0fac2e4500dabe0009e67214ff5f5447ce83dd`) — runs on `node24` runtime
- `actions/setup-node` → v6.3.0 (`53b83947a5a98c8d113130e565377fae1a50d02f`) — runs on `node24` runtime
- `actions/upload-artifact` → v7.0.0 (`bbbca2ddaa5d8feaa63e36b76fdaad77386f024f`) — runs on `node24` runtime
- Removed `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var (no longer needed)

**Dependencies updated to latest:**

- `zod`: `3.23.8` → `4.3.6` — fully compatible; `@modelcontextprotocol/sdk@1.27.1` explicitly declares `zod: '^3.25 || ^4.0'` peer dependency. No schema API changes required — all usage (`z.object`, `z.string`, `z.number`, `z.enum`, `z.array`, `.min`, `.max`, `.optional`, `.default`, `.describe`) is unchanged in v4.
- `@modelcontextprotocol/sdk`: `1.6.1` → `1.27.1`
- `typescript`: `5.7.2` → `5.9.3`
- `tsx`: `4.19.2` → `4.21.0`
- `@types/node`: `25.5.0` (unchanged — already latest)

All 192 tests pass after upgrades.

---

## [1.7.0] — 2026-03-18

### Added

**Comprehensive test suite expanded to 192 tests across 8 files** — new coverage for previously untested modules:

- `src/utils/watermark.test.ts` — 22 tests: `getInstallId` format and session consistency; `embedWatermark` invisible-char count (64), position after first newline, visible content preservation, no-newline path, nonce randomness; `detectWatermark` roundtrip correctness, edge cases (empty string, partial bits, cross-call installId consistency); `responseIntegrityToken` determinism, collision resistance, invisible-char stripping before hash
- `src/utils/guard.test.ts` — 29 tests: `isExtractionAttempt` positive cases (18 extraction phrases), negative cases (11 legitimate queries), case-insensitivity, short/empty query detection; `withNotice` IP notice presence and ordering, watermark embedding; `IP_NOTICE` and `EXTRACTION_REFUSAL` content assertions
- `src/services/cache.test.ts` — 21 tests: `LRUCache` get/set, TTL expiry with fake timers, `has()`, `clear()`, `size()`, overwrite, custom TTL; `DiskCache` get/set via `WS_CACHE_DIR` env override, missing key, expired entry, cross-instance persistence, graceful I/O error handling

**GitHub Actions updated to Node.js 24-compatible action versions**:

- `actions/checkout` → v4.3.1 (`34e114876b0b11c390a56381ad16ebd13914f8d5`)
- `actions/setup-node` → v4.4.0 (`49933ea5288caeca8642d1e84afbd3f7d6820020`)
- `actions/upload-artifact` → v4.6.2 (`ea165f8d65b6e75b540449e92b4886f43607fa02`)

Eliminates the "Node.js 20 actions are deprecated" CI warning.

**CI test job switched to `test:coverage`** — the previous `npm test` (no coverage output) caused the coverage artifact upload step to fail with "No files were found". Changed to `npm run test:coverage`.

**`@types/node` updated to 25.5.0** — aligned with TypeScript 5.x (`ts5.7` dist-tag). Previously at 22.x.

---

## [1.6.0] — 2026-03-18

### Added

**Python audit category** — 11 new patterns covering the OWASP Python Security Cheat Sheet:

- SQL injection via f-string or `.format()` interpolation
- `eval()` / `exec()` with dynamic input (RCE)
- `subprocess` with `shell=True` (command injection)
- `os.system()` call (command injection)
- Bare `except:` clause (swallows all errors including `KeyboardInterrupt`)
- `pickle.loads()` from untrusted source (deserialization RCE)
- MD5 / SHA1 used for password hashing (weak crypto)
- `requests` with `verify=False` (TLS validation disabled)
- Mutable default argument (`def fn(x=[])`), classic Python footgun
- `print()` in production code
- `open()` with user-controlled path (path traversal)

`ws_audit` now supports `.py` source files and skips `__pycache__/`, `.venv/`, `venv/`, `env/` directories.

**Full unit test suite** — 106 tests across 5 files (Vitest, ESM-native, `pool: forks`):

- `src/sources/registry.test.ts` — LIBRARY_REGISTRY integrity, `lookupById`, `lookupByAlias`, `fuzzySearch`
- `src/tools/audit.test.ts` — `buildCommentMap`, all 11 Python patterns (positive + negative cases), security / TypeScript / React / Node smoke tests, category coverage
- `src/tools/auto-scan.test.ts` — all 8 manifest parsers (temp dirs): `package.json`, `requirements.txt`, `pyproject.toml` (Poetry + PEP 517), `Cargo.toml`, `go.mod`, `pom.xml`, `composer.json`, `build.gradle` / `.kts`
- `src/utils/extract.test.ts` — topic relevance ranking, truncation, document order preservation
- `src/utils/sanitize.test.ts` — prompt injection stripping, `<script>` / `<style>` removal, navigation link cleanup

**GitHub Actions CI pipeline** (`.github/workflows/ci.yml`):

- Three jobs run on push and pull requests to `main`
- `typecheck`: `tsc --noEmit`
- `test`: `vitest run`, uploads coverage artifact
- `build`: `npm run build` + `npm audit --audit-level=high`, uploads dist artifact
- `build` requires both `typecheck` and `test` to pass
- Pinned action SHAs for supply chain integrity

**`typecheck` npm script** — runs `tsc --noEmit` without the build step. Separated from the build for use in CI and pre-commit hooks.

**`.node-version` file** — pin Node.js 24 for reproducible CI environments.

### Fixed

- **Python SQL injection false positive**: the `%` detection pattern now requires `%` to appear after a closing quote, distinguishing `cursor.execute("..." % var)` (injection) from `cursor.execute("... %s", (var,))` (parameterized query). The old regex incorrectly flagged `%s` SQL placeholders inside the query string.
- **Cargo.toml parser**: the section boundary regex now uses `\n[` (newline + bracket) instead of any `[`, so inline values like `features = ["derive"]` no longer terminate the `[dependencies]` block early. Only `tokio = "1"` and `reqwest = "0.11"` were not being detected.
- **`pyproject.toml` PEP 517 parser**: same fix for the `[project]` section boundary. The regex was stopping at `dependencies = [` or at `uvicorn[standard]` extras syntax instead of continuing to the actual next TOML section header.
- **composer.json filter**: changed `!p.startsWith("php")` to `p !== "php" && !p.startsWith("php-")`. The old filter excluded `phpunit/phpunit` (and any PHP testing package with a `php*` prefix) instead of only filtering the `php` version constraint entry and `php-64bit` platform variants.
- **Test files in dist**: added `src/**/*.test.ts` to `tsconfig.json` exclude list. Test files were being compiled and obfuscated into `dist/` on every production build.

### Changed

- Tool description updated: 50+ patterns → 60+ patterns, 8 categories → 9 categories, Python listed explicitly
- Source extensions in `ws_audit` scanner: `.py` added alongside `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.html`

---

## [1.5.0] — 2026-03-18

### Added

**Registry expanded to 330+ libraries** — 45 new entries from the audit:

- Backend: NestJS, Elysia, Nitro
- CMS: Payload CMS, Strapi, Contentful
- GraphQL clients: Apollo Client, urql
- Vector databases: Pinecone, Qdrant
- Query builders: Kysely
- Sync: Electric SQL
- HTTP utils: ky, clsx, tailwind-merge
- Rich text / content: Slate.js, unified, MDX, Fumadocs
- Package managers / bundlers: pnpm, Webpack
- Python AI/ML: LangChain, LlamaIndex, CrewAI, LangGraph, HuggingFace Transformers
- Go: Gin, Fiber, GORM, chi
- Rust: Axum, Actix Web, sqlx, Tokio
- Vue ecosystem: Pinia, Nuxt Content
- Email: Nodemailer
- Accessible UI: Ariakit, Zag.js, Panda CSS
- Real-time: PartyKit
- AI chat UI: assistant-ui

**22 new `ws_search` topic entries** — WebAssembly, Vector Search / Embeddings, MCP Protocol, AI Agents & Tool Calling, RAG, Prompt Engineering, gRPC / Protocol Buffers, Server-Sent Events, JSON Schema, JSON-LD / Structured Data, OpenTelemetry, Email Deliverability, Monorepo Patterns, Semantic Versioning, Web Animations API, NestJS, Elysia, Payload CMS, Kysely, Pinia, assistant-ui

**34 new `AUTHORITATIVE_DOMAINS`** — `docs.nestjs.com`, `elysiajs.com`, `hono.dev`, `tanstack.com`, `kysely.dev`, `opentelemetry.io`, `turbo.build`, `nx.dev`, `biome.sh`, `bun.sh`, `deno.com`, `docs.anthropic.com`, `platform.openai.com`, `modelcontextprotocol.io`, `docs.langchain.com`, `docs.llamaindex.ai`, `docs.crewai.com`, `reactnavigation.org`, `motion.dev`, `pinia.vuejs.org`, `docs.partykit.io`, `assistant-ui.com`, `pytorch.org`, `huggingface.co`, `docs.pinecone.io`, `qdrant.tech`, `grpc.io`, `protobuf.dev`, `json-schema.org`, `semver.org`, `webassembly.org`, `payloadcms.com`, `strapi.io`, `docs.expo.dev`

---

## [1.4.0] — 2026-03-18

### Added

**Cryptographic response watermarking** (`src/utils/watermark.ts`):

- Generates a persistent 4-byte installation ID on first run, saved to `~/.ws-mcp-install.key` (mode 0600)
- Embeds a 64-bit fingerprint per response: `installId (32 bits) + nonce (32 bits)` as invisible Unicode math operators `U+2061` / `U+2062` (FUNCTION APPLICATION / INVISIBLE TIMES)
- Characters are visually invisible, survive copy-paste, and are not flagged by whitespace strippers unlike ZWS/ZWJ
- `detectWatermark(text)` extracts `installId` and `nonce` for forensic provenance — if data surfaces publicly, the source installation can be identified
- `responseIntegrityToken(text)` produces a SHA-256 digest of the clean content for audit logging

`withNotice()` in `guard.ts` now calls `embedWatermark()` — every registry response is watermarked at the point of IP notice injection.

### Security

Every response from `ws_resolve_library`, `ws_get_docs`, `ws_best_practices`, `ws_search`, and `ws_auto_scan` carries an installation-specific fingerprint. If extracted data surfaces outside authorised use, it can be traced to a specific server instance.

---

## [1.3.0] — 2026-03-18

### Added

**Extraction guard** (`src/utils/guard.ts`):

- `isExtractionAttempt()` blocks bulk enumeration, listing, and dump queries
- `withNotice()` prepends the ELv2 IP notice to all registry responses
- `EXTRACTION_REFUSAL` returned for extraction attempts instead of data

Guard wired into all five registry-touching tools: `ws_resolve_library`, `ws_get_docs`, `ws_best_practices`, `ws_search`, `ws_auto_scan`. Extraction attempts return a license violation message.

PROPRIETARY DATA NOTICE added to all four tool descriptions that touch the registry — signals to AI models that bulk extraction violates ELv2 and AI provider IP policies.

### Changed

All registry tool responses now prepend the ELv2 IP notice via `withNotice()`.

---

## [1.2.0] — 2026-03-18

### Added

**`node` audit category** — 5 patterns: `console.log` in production, synchronous fs operations (event loop blocking), unhandled callback errors, `process.exit()` without cleanup, plain HTTP fetch

**6 new security patterns**: SQL injection via template literals (OWASP A03), command injection in child_process, SSRF via user-controlled fetch URLs, path traversal in fs functions, `NEXT_PUBLIC_` secret exposure, implied eval in setTimeout / setInterval

**4 new accessibility patterns**: `role="button"` on non-button elements (WCAG 2.1.1), `href="#"` / `href="javascript:"` placeholder links, missing `lang` attribute on `<html>`, `prefers-reduced-motion` not respected

**4 new React patterns**: conditional hook call detection (Rules of Hooks), component called as plain function, side effects at render scope, inline object/array props causing re-renders

**3 new layout patterns**: CSS `@import` chain detection, render-blocking `<script>` without async/defer, `document.querySelector` in React

**4 new TypeScript patterns**: `@ts-ignore` suppressor, floating Promises, `require()` instead of import, double assertion (`as unknown as T`)

**3 new Next.js patterns**: `middleware.ts` not renamed to `proxy.ts` (Next.js 16), page missing metadata export, `fetchpriority` missing on LCP image

Block comment map: lines inside `/* */` blocks are skipped to reduce false positives.

Test file skip: `.test.`, `.spec.`, `.d.ts`, `__tests__/`, `.stories.` files are excluded from audit.

Extended `AuditPattern.test()` signature: now receives `lines[]` and `lineIndex` for context-aware multi-line checks.

Updated `fetchBestPractice()` with direct routes to typescript-eslint.io/rules, OWASP Node.js Cheat Sheet, web.dev/articles/optimize-lcp, and react.dev/reference/rules.

### Changed

- Audit categories extended: `"node"` added alongside the existing 7
- Tool description updated to reflect 8 categories and 50+ patterns
- README rewritten with pattern tables, example output, and fetch chain documentation

---

## [1.1.0] — 2026-03-18

### Added

14 new React Native and Expo libraries: `sonner-native`, `expo-notifications`, `expo-router`, `react-native-netinfo`, `expo-camera`, `expo-image-picker`, `expo-secure-store`, `expo-location`, `react-native-async-storage`, `react-native-bottom-sheet`, `react-native-paper`, `expo-haptics`, `react-native-maps`, `react-native-webview`

11 new topic patterns in `ws_search` for React Native and Expo: React Compiler, Expo Notifications, Gesture Handler, Reanimated, NetInfo, React Navigation, NativeWind, FlashList / FlatList, EAS Build, React Native New Architecture

Obfuscated build output — `dist/` is obfuscated before publishing.

Elastic License 2.0.

### Fixed

- `ws_search` no longer falls back to MDN for React Native / Expo queries — routes to `reactnative.dev` and `docs.expo.dev`
- `react-native-gesture-handler` search points to the correct current docs URL

---

## [1.0.0] — 2026-03-18

### Initial release

- 6 tools: `ws_resolve_library`, `ws_get_docs`, `ws_best_practices`, `ws_auto_scan`, `ws_search`, `ws_audit`
- 230+ library registry with llms.txt priority
- 4-step fetch chain: llms.txt → llms-full.txt → Jina Reader → GitHub README
- npm / PyPI fallback for libraries outside the registry
- Code audit tool with file:line issue reporting across 7 categories
- Freeform search with curated source mapping (OWASP, MDN, web.dev, W3C, WCAG)
