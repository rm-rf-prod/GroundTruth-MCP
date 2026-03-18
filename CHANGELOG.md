# Changelog

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
