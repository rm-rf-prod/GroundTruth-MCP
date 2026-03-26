# GT MCP Server: Comprehensive Code Analysis

## Executive Summary
Analysis of 8 core files in the GT MCP server codebase, evaluating: (1) What it does, (2) Patterns used, (3) Improvement opportunities, (4) Missing elements.

---

## 1. package.json (Configuration & Dependencies)

### What it does
- Defines project metadata, version (3.0.7), and MCP identity
- Configures build pipeline with JavaScript obfuscation (RC4 encoding, 0.9 threshold)
- Manages 2 runtime dependencies (minimal: @modelcontextprotocol/sdk, zod)
- Orchestrates dev/build/test/release lifecycle with npm scripts
- Publishes as dual binaries: `@groundtruth-mcp/gt-mcp` and `gt-mcp`

### Patterns used
- **Minimal dependency strategy**: Only SDK + validation library (zod) as runtime deps
- **Build obfuscation pipeline**: 3-stage build with swap/obfuscate/revert for private config
- **Semantic versioning** with automated changelog + version update scripts
- **MCP publisher integration**: Coordinates npm publish with mcp-publisher CLI
- **Dual entry points**: Named binaries for flexibility in installation contexts

### What could be improved
1. **Missing dependency audit scripts**: No `npm audit` or `npm audit fix` in CI/CD pipeline (security review opportunity)
2. **No pre-commit hooks**: Consider `husky` + `lint-staged` for preventing bad commits
3. **Build output not git-ignored properly**: Should verify `dist/` and `*.d.ts` cleanup before publishing
4. **Obfuscation reversibility**: RC4 string array is not cryptographically secure; consider dual build (obfuscated for npm, source for private use)
5. **Missing test coverage thresholds**: `test:coverage` runs but no threshold enforcement in CI

### What's missing
1. **Security policy file** (SECURITY.md) for vulnerability reporting
2. **Contribution guidelines** (CONTRIBUTING.md) referenced in metadata
3. **Engines configuration for npm**: Could specify npm >= 9, node >= 24 (currently only node)
4. **Workspace/monorepo setup**: If expanding, needs path mapping
5. **Type checking in prepublish**: Should run `typecheck` before build

---

## 2. src/utils/extract.ts (Content Extraction & BM25 Scoring)

### What it does
- Extracts topic-relevant sections from documentation using BM25-inspired algorithm
- Implements IDF weighting, TF saturation, field-length normalization, and multi-signal bonuses
- Handles markdown parsing, synthetic section generation for plain text, and greedy section selection
- Returns bounded content (charLimit) with truncation flag for downstream handling

### Patterns used
- **BM25 Information Retrieval**: Robertson-Sparck Jones IDF formula with k1=1.5, b=0.75
- **Stop word filtering**: 40+ common English words removed to reduce noise
- **Inverse Document Frequency**: Scores terms by rarity across corpus
- **Multi-signal scoring**: Heading match (5x), code block bonus (+5), section depth (+1 for h1/h2)
- **Synthetic section generation**: Handles non-markdown content via paragraph-based chunking
- **Greedy section selection**: Picks highest-scoring sections up to charLimit
- **Document flow preservation**: Re-sorts picked sections to maintain original order

### What could be improved
1. **Stop words are English-only**: No support for other languages despite having i18n in registry
2. **BM25 constants are hardcoded**: k1=1.5, b=0.75 could be tunable parameters
3. **Heading weight (5x) is arbitrary**: Should justify or benchmark this multiplier
4. **Code block detection (```) is fragile**: Fails on indented code or language-tagged blocks
5. **Synthetic section generation lacks heuristics**: Could use topic keywords to improve heading generation
6. **No min/max section size controls**: Could eliminate very small or very large sections
7. **Token math could be more precise**: `CHARS_PER_TOKEN` is approximate; consider actual tokenization
8. **Query tokenization is simplistic**: No stemming, lemmatization, or partial matches beyond substring

### What's missing
1. **Configurable scoring weights**: API should accept `{headingWeight, codeBonus, depthBonus}`
2. **Language support**: Parameter for non-English stop word sets
3. **Section quality scoring**: Penalize sections with mostly code, few words, or no headings
4. **Deduplication**: No removal of near-duplicate sections within extracted content
5. **Metadata preservation**: No tracking of which sections were picked vs. rejected (useful for debugging)
6. **Caching**: Extracted content for same query could be cached
7. **Batch extraction**: No multi-topic extraction in single pass (would need to aggregate IDF)
8. **Section linking**: No preservation of markdown links between sections
9. **Performance metrics**: No instrumentation for scoring speed or section quality

---

## 3. src/services/cache.ts (Two-Tier Caching)

### What it does
- Implements memory-based LRU cache (200 docs, 500 resolves) with stale-while-revalidate pattern
- Provides persistent disk cache with SHA-256 keying and size/expiry management
- Exports `docCache`, `resolveCache` for in-memory, and `diskDocCache` for disk persistence
- Gracefully degrades on I/O errors (logs but doesn't throw)

### Patterns used
- **LRU eviction**: Map-based tracking with `.has()` + `.delete()` to maintain size
- **Stale-while-revalidate**: `SWR_STALE_TTL_MS` (3600s) allows serving stale data while refreshing
- **Generic LRUCache class**: Type-safe implementation reusable across data types
- **Disk cache with hash keys**: SHA-256 of URL/query prevents filesystem collisions
- **Graceful I/O degradation**: Errors logged but don't break application flow
- **Atomic reads/writes**: No file locking, but single-operation access reduces races

### What could be improved
1. **No eviction policy for disk cache**: 1000 entry limit is simplistic; should track access time
2. **Hash collisions not handled**: Two URLs hashing to same SHA-256 would silently overwrite
3. **No cache invalidation API**: Can't manually purge cache by pattern or tag
4. **Disk cache location not configurable**: Hard-coded to `~/.gt-mcp-cache`; should respect `$XDG_CACHE_HOME`
5. **No cache statistics**: Can't observe hit/miss rates, eviction frequency
6. **LRU eviction is dumb**: Always removes oldest; should consider access frequency
7. **SWR timeout is global**: `SWR_STALE_TTL_MS` doesn't vary by content type (docs vs. resolves)
8. **No concurrent access safeguards**: Multiple processes reading same cache could race

### What's missing
1. **TTL per entry**: Different content types need different cache lifetimes (npm versions vs. docs)
2. **Cache key namespace**: No separation of cache spaces (e.g., `docs:url` vs. `resolve:pkg`)
3. **Compression**: Large cached docs aren't compressed (could save disk space)
4. **Async disk I/O**: Current sync operations block event loop
5. **Cache warming**: No preload or population API
6. **Observability**: No metrics for hit/miss/eviction tracking
7. **Partial cache clearing**: Can't invalidate cache by URL pattern or age
8. **Persistent LRU metadata**: Disk cache doesn't track access order across restarts

---

## 4. src/services/fetcher.ts (HTTP Fetching & Multi-Path Fallbacks)

### What it does
- Core HTTP fetching with intelligent multi-path fallbacks (direct → Jina Reader → empty)
- Implements retry logic (500-1500ms jitter for 429/503), 5-redirect limit, SSRF guards
- Specialized loaders for npm, PyPI, GitHub, Sitemap, and generic docs discovery
- Handles JavaScript-heavy content via Jina Reader (25s timeout), in-flight deduplication
- Auto-discovers llms.txt/llms-full.txt endpoints and indexes documentation sites

### Patterns used
- **Exponential backoff retry**: 500-1500ms jitter for rate-limit responses
- **Multi-path fallback strategy**: Direct extraction → Jina → empty string
- **SSRF protection at each hop**: Custom undici Agent blocks private IP ranges
- **In-flight deduplication**: Promise tracking prevents concurrent duplicate fetches
- **Timeout safeguards**: 5s default, 25s for Jina, respects request-scoped overrides
- **Content type detection**: Identifies index/TOC pages (50%+ links) vs. real docs
- **Graceful degradation**: Returns empty string on complete failure (vs. throwing)
- **GitHub multi-source strategy**: raw.githubusercontent.com + REST API fallback

### What could be improved
1. **Retry logic is simplistic**: Only retries 429/503; should handle 408 (timeout), 502 (bad gateway)
2. **Max redirects (5) is arbitrary**: Should be configurable per request
3. **Jina timeout (25s) is long**: Could cause slow requests if Jina is failing
4. **No circuit breaker across requests**: Domain-level failure tracking would prevent cascading failures
5. **Index ranking is fragile**: Regex for "50%+ links" doesn't handle nested markdown
6. **GitHub fallback order uncertain**: raw.githubusercontent.com vs. API priority unclear
7. **Sitemap parsing is basic**: No handling of sitemap indexes or compressed XML
8. **No request pooling**: Undici Agent per request instead of shared pool

### What's missing
1. **Caching coordination**: Doesn't check LRU before fetching (redundant if caller caches)
2. **Request timeout instrumentation**: No metrics for slow endpoints
3. **Charset detection**: Assumes UTF-8; should detect from Content-Type header
4. **Redirect chain logging**: Could record which redirects occurred
5. **Content-Encoding handling**: Doesn't check Accept-Encoding / gzip handling
6. **Rate limit header parsing**: Could extract Retry-After for smarter backoff
7. **Concurrent fetch limit**: No throttling for max concurrent requests (could DOS)
8. **Request signing for GitHub**: No token auth for higher API rate limits
9. **Fallback metrics**: No tracking of which fallback paths succeed/fail

---

## 5. src/utils/guard.ts (Multi-Layer Security)

### What it does
- Path traversal prevention via whitelist/blacklist (blocks /etc, /proc; whitelists .git, .vscode)
- SSRF protection via `assertPublicUrl()` (HTTPS only, blocks private ranges, .local domains)
- Bulk extraction detection via regex (blocks "enumerate", "scrape", "dump", etc.)
- Embeds Elastic License 2.0 notice and cryptographic watermark for forensic provenance

### Patterns used
- **Whitelist + blacklist path filtering**: Blocks dangerous system paths, allows development tool configs
- **URL validation chain**: Protocol check (HTTPS) → private IP blocking → localhost detection
- **Regex-based bulk extraction detection**: 9 patterns for enumeration/scraping language
- **Watermark embedding**: Calls `withNotice()` for license notice + watermark insertion
- **Licensing enforcement**: IP_NOTICE constant states non-reproducible use only

### What could be improved
1. **Whitelist is hardcoded**: Should be configurable or environment-driven
2. **Regex patterns for extraction detection are weak**: "all" matches innocuous phrases
3. **No logging of blocked attempts**: Can't audit security rejections
4. **assertPublicUrl() doesn't validate TLD**: .local is blocked but .onion, .test aren't
5. **No IP validation library**: Custom parsing could miss edge cases (IPv6, CIDR notation)
6. **Watermark embedding always happens**: Could be opt-out for performance-critical paths
7. **SSRF check doesn't follow redirects**: Could bypass if endpoint redirects to localhost

### What's missing
1. **Rate limiting per IP**: No protection against request flooding
2. **User-Agent validation**: No filtering of suspicious clients
3. **Referrer checking**: Could validate origin of requests
4. **Content-Type validation**: No check that response is expected type
5. **Outbound bandwidth limits**: No cap on response size before downloading
6. **DNS rebinding protection**: Could cache resolved IPs and validate consistency
7. **Audit logging**: Security events should go to structured logs
8. **Policy override mechanism**: No way to explicitly allow suspicious patterns
9. **Performance optimization**: Regex compilation could be memoized

---

## 6. src/utils/sanitize.ts (Content Cleanup)

### What it does
- Removes navigation boilerplate (skip-links, breadcrumbs, edit buttons, pagination)
- Strips prompt injection attempts (regex patterns for "ignore", "disregard", etc.)
- Removes HTML script/style tags and collapses excessive whitespace
- Enforces 512KB content limit with graceful truncation
- Saves 15-25% tokens via sanitization

### Patterns used
- **Navigation pattern regex**: 20+ patterns matching footer sections, breadcrumbs, cookies banners
- **Prompt injection regex**: Detects "instructions after this", "disregard all prior", etc.
- **HTML element removal**: Script/style tag stripping (crude regex, not HTML parser)
- **Whitespace collapsing**: Converts 4+ newlines to 3 (document flow preservation)
- **Size limiting**: 512KB cap with truncation warning

### What could be improved
1. **Regex-based HTML parsing is fragile**: Missing script/style tags inside comments or CDATA
2. **Whitespace collapsing could break code blocks**: Doesn't distinguish content from markdown syntax
3. **Prompt injection patterns are heuristic**: Could false-positive on legitimate documentation
4. **No language/encoding detection**: Assumes UTF-8 throughout
5. **512KB cap is arbitrary**: Should scale with model context window
6. **No structured logging**: Can't observe what patterns matched during sanitization
7. **Footer detection relies on position**: Could miss navigation embedded in content
8. **No preservation of semantic structure**: Strips nav but loses TOC anchors

### What's missing
1. **HTML parser library**: Should use htmlparser2 or cheerio instead of regex
2. **Content quality scoring**: Could penalize sections with too many external links
3. **Metadata extraction**: Shouldn't strip `<meta>` tags useful for attribution
4. **Link preservation**: Could annotate which links were navigation vs. content links
5. **Table-of-contents detection**: Could extract and preserve structured TOC
6. **Language detection**: Should adapt patterns to detected language
7. **Custom rule configuration**: Users/libraries could define additional patterns
8. **Performance metrics**: No tracking of sanitization speed or compression ratio
9. **Encoding normalization**: Could handle different charsets beyond UTF-8

---

## 7. src/utils/watermark.ts (Forensic Provenance)

### What it does
- Embeds 64-bit watermarks in documentation text using invisible Unicode characters
- Encodes 32-bit installation ID + 32-bit nonce for forensic provenance tracking
- Generates and persists installation ID in `~/.gt-mcp-install.key` (mode 0o600)
- Detects watermarks in text and computes response integrity tokens (SHA-256)

### Patterns used
- **Unicode watermarking**: U+2061 (FUNCTION APPLICATION) for bit 0, U+2062 (INVISIBLE TIMES) for bit 1
- **64-bit encoding**: 32-bit installation ID + 32-bit nonce packed into 16 Unicode characters
- **Watermark placement**: After first newline in text (visible but non-breaking position)
- **Installation ID persistence**: Stored in dotfile with restrictive permissions (0o600)
- **Deterministic generation**: Nonce computed from text content (allows reproducible watermarking)

### Patterns used (continued)
- **Integrity token**: SHA-256 hash with invisible characters stripped (detects tampering)
- **Graceful watermark detection**: Returns {found, installId, nonce} object; doesn't throw on failure

### What could be improved
1. **Nonce generation is weak**: `Math.random()` is not cryptographically secure
2. **No persistence of nonce**: Watermarks aren't tracked server-side; can't verify ownership
3. **Installation ID file not encrypted**: Stored as plaintext; consider encryption at rest
4. **Watermark placement after first newline is fragile**: Could fail on single-line documents
5. **No version/format field**: Watermark format can't evolve without detection failures
6. **Unicode characters could be stripped**: More robust schemes would use invisible formatting
7. **Integrity token is just hash**: Doesn't authenticate; attacker can re-hash modified content
8. **No watermark removal prevention**: Determined adversary could strip Unicode characters

### What's missing
1. **Watermark versioning**: Format version field for future algorithm changes
2. **Cryptographic signing**: HMAC or signature to prevent forgery
3. **Nonce rotation**: Periodic changes to prevent frequency analysis
4. **Server-side verification**: Database of valid installation IDs
5. **Watermark redundancy**: Multiple watermark copies for robustness
6. **Entropy analysis**: Detection of suspicious character distributions
7. **Hardware fingerprinting**: Could tie watermark to device characteristics
8. **Expiration timestamps**: Watermarks could have validity windows
9. **Audit trail**: Logging of watermark creation/detection events

---

## 8. src/sources/registry.ts (Library Metadata Registry)

### What it does
- Centralized registry of 422+ technology documentation sources
- Provides lookup functions: `lookupById()` (direct), `lookupByAlias()` (fuzzy), `fuzzySearch()` (ranking)
- Maps library names to documentation URLs, GitHub repos, npm/PyPI packages, best practices paths
- Includes metadata: aliases, descriptions, language tags, category tags

### Patterns used
- **Structured entry format**: Consistent metadata across 422+ entries (id, name, aliases, docsUrl, etc.)
- **Alias-based fuzzy matching**: Case-insensitive name/alias/package lookups with fallbacks
- **Scored fuzzy search**: Exact match (100), startsWith (60/50), includes (30/20) for names/aliases
- **URL template placeholders**: `{slug}` patterns for generating URLs (e.g., npm package links)
- **Tag-based categorization**: 60+ technology categories for browsing
- **Best practices paths**: Dedicated URLs for each library's best-practices documentation
- **Multi-source mapping**: Same library can have npm, PyPI, GitHub, crates.io references

### What could be improved
1. **No validation on entry creation**: Missing required fields could silently fail
2. **Aliases aren't normalized**: Case variations could create duplicates
3. **URL patterns lack validation**: `{slug}` placeholders could be missing or malformed
4. **No entry versioning**: Can't track when documentation changed
5. **Best practices paths are hardcoded**: No mechanism to discover them automatically
6. **Tag taxonomy is informal**: No schema for what tags are allowed
7. **Search ranking ignores frequency**: All exact matches weight equally
8. **No deprecation marking**: Old libraries stay in registry forever
9. **Language field is list but not standardized**: "TypeScript" vs "typescript" inconsistencies

### What's missing
1. **Entry validation schema**: Zod schema for structured validation
2. **Update timestamps**: Track when entries were last modified
3. **Maintenance status**: Flag abandoned, deprecated, or low-quality libraries
4. **Community score**: User ratings or download metrics
5. **Duplicate detection**: Identify and merge near-duplicate entries
6. **Search analytics**: Track which libraries are searched most
7. **Auto-generated entries**: Script to auto-populate from npm/PyPI registries
8. **Entry relationships**: Link related libraries (e.g., "Next.js" → "React", "TypeScript")
9. **Migration paths**: Track library splits, merges, renames
10. **Curation metadata**: Who maintains each entry, last review date
11. **Export formats**: JSON schema, GraphQL, etc. for downstream consumption
12. **Performance index**: Search speed optimizations for large registry growth

---

## Cross-File Observations

### Architectural Patterns
- **Defense in depth**: Guards at multiple layers (path, URL, prompt injection, watermark)
- **Graceful degradation**: Failed fetches return empty string; cache errors don't crash
- **Minimal dependencies**: Only SDK + zod; no heavy transitive deps
- **Consistent error handling**: Errors logged but often don't throw
- **Caching + freshness**: LRU + disk cache with SWR pattern

### Security Strengths
- SSRF protection at HTTP layer
- Path traversal whitelist/blacklist
- Prompt injection detection
- Watermark-based provenance tracking
- Elastic License enforcement messaging

### Security Gaps
- No request rate limiting
- Watermarking not cryptographically secure
- Sanitization uses regex instead of parser
- No audit logging of blocked requests
- Installation ID stored in plaintext

### Performance Opportunities
- Disk cache I/O is synchronous (blocks event loop)
- Fetch retry backoff could be smarter (no Retry-After parsing)
- BM25 scoring could cache IDF across requests
- Regex compilation in sanitize.ts could be memoized
- Registry fuzzy search could use trie data structure

### Testing Gaps
- No fixtures for edge cases (malformed HTML, invalid URLs)
- Cache eviction behavior not tested
- Watermark detection could fail silently on certain inputs
- Fuzzy search ranking not validated against ground truth
- Fetch fallback paths not thoroughly exercised

---

## Recommended Next Steps

1. **Add structured validation** (Zod schemas for registry entries, guard inputs)
2. **Implement async disk cache** (non-blocking I/O via promises)
3. **Switch to HTML parser** (cheerio instead of regex in sanitize.ts)
4. **Add observability** (metrics for cache hit/miss, fetch latency, security violations)
5. **Enhance watermarking** (cryptographic signing, version field, nonce tracking)
6. **Improve registry** (validation schema, curation metadata, auto-discovery)
7. **Rate limiting** (per-IP or per-source request throttling)
8. **Comprehensive test suite** (edge cases, fallback paths, security scenarios)

