# MCP Server Best Practices (2025-2026) -- Research Brief

**Prepared:** 2026-03-26
**Scope:** Deep research on Model Context Protocol server design, caching, library resolution, Jina Reader integration, npm publishing, and how leading tools (Context7, Cursor) handle documentation lookups.

---

## Executive Summary

The MCP ecosystem matured rapidly between late 2024 and early 2026. What started as Anthropic's open protocol for connecting LLMs to external tools has become the standard integration layer adopted by OpenAI, Google, and every major AI code editor. The best MCP servers share common traits: they use registry-based resolution with dynamic fallbacks, implement multi-tier caching (memory + disk with SWR), design tools around user workflows rather than raw API endpoints, and treat every response as context-window real estate that must be compact and high-signal. The GroundTruth MCP server already implements many of these patterns well -- this brief identifies where it aligns with industry best practice and where gaps exist.

---

## 1. Library Documentation Fetching Strategies

### How Top MCP Servers Fetch Docs

The dominant pattern across documentation-serving MCP servers is a **prioritized fallback chain**:

1. **llms.txt / llms-full.txt** -- The llms.txt specification (proposed by Jeremy Howard, September 2024) has become the preferred first-try source. Over thousands of documentation sites now serve these files via platforms like Mintlify and Fern. llms.txt is a lightweight table-of-contents with one-line descriptions per page; llms-full.txt contains the complete documentation body. AI coding assistants (Cursor, Claude Code) actively consume these files. General-purpose chatbots (GPTBot, ClaudeBot) do not crawl them during inference -- Semrush confirmed zero visits from major AI crawlers over a 3-month test.
   - Source: [llmstxt.org](https://llmstxt.org/)
   - Source: [Mintlify llms.txt](https://www.mintlify.com/docs/ai/llmstxt)
   - Source: [Fern llms.txt](https://buildwithfern.com/learn/docs/ai-features/llms-txt)

2. **Direct HTML fetch + extraction** -- For sites without llms.txt, a direct HTTP GET followed by HTML-to-Markdown conversion is the fastest path. This avoids external API dependencies and rate limits. The GroundTruth server implements this via `tryFetch` + `convertHtmlToMarkdown`, checking tag density to detect already-plain-text content.

3. **Jina Reader API** -- For JavaScript-rendered pages (SPAs, React docs sites), Jina Reader (`r.jina.ai/{url}`) renders the page in a browser and returns clean Markdown. This is the standard fallback for dynamic content.

4. **DevDocs.io** -- Pre-parsed, offline-capable docs for 200+ technologies. Useful as a tertiary fallback for well-known standard libraries.

5. **GitHub README/CHANGELOG** -- Raw content from `raw.githubusercontent.com` for libraries that lack dedicated documentation sites.

### Race vs. Waterfall

Two approaches exist in production:
- **Waterfall** (try sources sequentially): Saves bandwidth but slower when early sources fail. GroundTruth's `fetchDocs` uses this for llms.txt candidates, then races the remaining sources.
- **Race** (`Promise.any`): Fires all candidates simultaneously, first good result wins. GroundTruth's `fetchAsMarkdownRace` implements this. Block's engineering playbook recommends this for latency-sensitive operations.
  - Source: [Block Engineering Blog](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)

**Best practice:** Hybrid -- try cheap/fast sources first (memory cache, disk cache, llms.txt), then race expensive sources (direct HTML, Jina) in parallel.

---

## 2. Caching Strategies

### Multi-Tier Caching

The industry consensus for MCP server caching follows a three-tier model:

| Tier | Storage | TTL | Purpose |
|------|---------|-----|---------|
| L1 | In-memory LRU | 30 min (fresh) + 60 min (SWR stale) | Hot path, sub-millisecond |
| L2 | Disk (JSON files) | Same TTL, survives process restarts | Persistent across npx invocations |
| L3 | Redis / external | 5 min - 24 hr (data-type dependent) | Shared across instances |

GroundTruth implements L1 (LRU, 200 entries) + L2 (disk, SHA-256 keyed JSON files in `~/.gt-mcp-cache`). The SWR (stale-while-revalidate) pattern with a 60-minute stale window is a strong choice -- it serves stale data immediately while background revalidation can happen on the next request.

**Key findings on TTL by data type:**
- Library documentation: 30 min - 2 hr (changes infrequently during a coding session)
- npm/PyPI package metadata: 1 hr (new releases are rare within a session)
- GitHub releases: 1 hr
- Sitemaps: 24 hr (sitemaps rarely change)
- Volatile data (search results): 5 min
  - Source: [Advanced Caching Strategies for MCP Servers](https://medium.com/@parichay2406/advanced-caching-strategies-for-mcp-servers-from-theory-to-production-1ff82a594177)
  - Source: [FastMCP Caching Middleware](https://gofastmcp.com/python-sdk/fastmcp-server-middleware-caching)

### In-Flight Deduplication

GroundTruth's `inFlightRequests` Map pattern (preventing N concurrent fetches of the same URL) is an important optimization that few MCP servers implement. This is especially valuable for documentation tools where multiple tool calls in a single conversation may request the same library's docs.

### Disk Cache Pruning

GroundTruth's `DiskCache.prune()` with a 1000-entry cap and mtime-based eviction is aligned with best practice. The mcp-cache proxy server uses a similar approach with 5-minute cleanup intervals.
  - Source: [mcp-cache](https://lobehub.com/mcp/swapnilsurdi-mcp-cache)

### Token-Aware Caching

A pattern emerging in 2025-2026: caching not just the raw content but a token-budget-aware version. Since MCP tool responses end up in the model's context window, caching pre-truncated content at common token limits (5K, 8K, 15K) avoids re-processing on every call.
  - Source: [MCP Best Practices Architecture Guide](https://modelcontextprotocol.info/docs/best-practices/)

---

## 3. Handling Unknown/Unsupported Libraries

### Graceful Degradation Patterns

The recommended approach from the MCP ecosystem combines several strategies:

1. **Registry lookup first, dynamic discovery second** -- If a library isn't in the static registry, attempt dynamic resolution via npm/PyPI metadata, GitHub search, or web search.

2. **Cascading fallback chain:**
   - Check static registry (instant, zero network)
   - Query npm/PyPI registry for package metadata (homepage URL, repository URL)
   - Try domain-root llms.txt discovery (`{homepage}/llms.txt`)
   - Fetch README from GitHub
   - Jina Reader on the homepage
   - Return a structured "not found" response with suggestions

3. **Structured error responses** -- Never return raw errors. Return a helpful message that tells the LLM what was attempted and what alternatives exist. The MCP spec defines specific error codes (`-32602` for invalid params, etc.).

4. **Circuit breaker pattern** -- GroundTruth implements this via `circuit-breaker.ts` with a 5-failure threshold and 30s reset. This prevents hammering a down service and improves latency for subsequent requests.
   - Source: [Error Handling in MCP Servers](https://mcpcat.io/guides/error-handling-custom-mcp-servers/)
   - Source: [MCP Best Practices](https://modelcontextprotocol.info/docs/best-practices/)

5. **Health monitoring with cached availability** -- The "Graceful Degradation" skill pattern checks dependency availability early, caches results with a 60-second TTL, and provides clear instructions for resolving missing services.
   - Source: [Smithery Error Recovery Skill](https://smithery.ai/skills/tianzecn/error-recovery)

### Spring AI Lesson

The Spring AI/MCP client startup issue (application fails entirely when MCP server unavailable) highlights the importance of `fail-fast=false` and lazy connection patterns. MCP servers should never cause hard failures in the host application.
  - Source: [Spring AI Issue #3232](https://github.com/spring-projects/spring-ai/issues/3232)

---

## 4. MCP Tool Design Patterns

### Input Validation

Zod is the standard for TypeScript MCP servers. Every tool parameter gets a Zod schema that provides:
- Runtime validation before handler execution
- Automatic JSON Schema generation for the MCP protocol
- TypeScript type inference
- Descriptive error messages that guide the LLM to correct its input

Validation happens automatically in the MCP SDK -- invalid parameters return structured errors without executing the handler.
  - Source: [Mastering Zod Validation in MCP Servers](https://sko.kr/en/blog/zod-for-mcp)
  - Source: [MCP Zod Validation Guide](https://www.byteplus.com/en/topic/541200)

### Error Handling

Critical rules:
- MCP servers must only write JSON-RPC messages to stdout. All logs go to stderr.
- Validate early, catch specific errors first, log internally, sanitize responses.
- Return valid JSON-RPC error responses instead of crashing.
- Four main error categories: transport/connection, protocol/schema, tool execution, and resource access.
  - Source: [Stainless MCP Error Handling](https://www.stainless.com/mcp/error-handling-and-debugging-mcp-servers)

### Response Formatting

Key principles from Block, Phil Schmid, and Peter Steinberger:

1. **Compact, high-signal responses** -- Tool responses consume context window tokens. Avoid walls of low-signal text. Prefer concise JSON or well-formatted Markdown fragments.

2. **Pagination for large datasets** -- Never return unbounded results. Provide follow-up tools or resource links for more detail on demand.

3. **Structured content (MCP June 2025 spec)** -- The `outputSchema` and `structuredContent` fields allow dual-format responses: JSON for the model, Markdown for the human.

4. **Tool annotations** -- `readOnlyHint`, `destructiveHint`, `idempotentHint` help both LLMs and users understand side effects.
  - Source: [Block's Playbook](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)
  - Source: [Phil Schmid MCP Best Practices](https://www.philschmid.de/mcp-best-practices)
  - Source: [The New Stack: 15 Best Practices](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)

### Workflow-First Design

The strongest consensus across all sources: design tools around user workflows, not API endpoints.

- "Don't expose raw, granular API endpoints like `GET /user` or `GET /file`" (Block)
- "Instead of three atomic tools, give the agent one high-level tool like `track_latest_order(email)`" (Phil Schmid)
- "MCP is a User Interface for AI agents. Build it like one." (Phil Schmid)
- "Don't mix read and write operations in the same tool" (Block)
- Tool names, descriptions, and parameters are prompts for the LLM -- invest in clear, specific descriptions.
  - Source: [Phil Schmid](https://www.philschmid.de/mcp-best-practices)
  - Source: [Block Engineering](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)

---

## 5. Registry-Based vs. Dynamic Library Resolution

### Registry-Based (GroundTruth Pattern)

GroundTruth uses a static `LIBRARY_REGISTRY` (97 public / 422+ private entries) mapping library names to metadata (docs URLs, llms.txt URLs, GitHub URLs, categories, aliases). This provides:
- Zero-latency resolution (no network call needed)
- Curated, verified documentation URLs
- Alias mapping (e.g., "next" -> "next.js")
- Version-specific documentation paths

**Advantage:** Speed, reliability, accuracy.
**Disadvantage:** Requires manual maintenance; unknown libraries fall through.

### Dynamic Resolution (Context7 Pattern)

Context7 uses a two-tool architecture:
- `resolve-library-id` -- Takes a human-friendly name, returns a Context7 library ID from a 9,000+ library database. Prioritizes by trust score and documentation coverage.
- `query-docs` -- Takes a Context7 ID and optional topic filter, returns relevant documentation chunks with configurable token limits.

The API backend, parsing engine, and crawling engine are private (not open source). The MCP server is open source.
  - Source: [Context7 GitHub](https://github.com/upstash/context7)
  - Source: [Context7 Blog](https://upstash.com/blog/context7-mcp)

### Hybrid Approach (Best Practice)

The optimal strategy combines both:
1. Static registry for known libraries (fast, reliable)
2. Dynamic resolution for unknown libraries (npm/PyPI metadata -> homepage -> llms.txt discovery)
3. Search-based fallback (web search for documentation URLs)

This is essentially what GroundTruth does with its `gt_resolve_library` -> `gt_get_docs` pipeline.

### MCP Registry (Server Discovery)

The official MCP Registry (`registry.modelcontextprotocol.io`) is a metaregistry -- it hosts metadata about MCP servers, not the servers themselves. Code lives in npm/PyPI/Docker Hub. The registry follows a REST API pattern (`GET /v0/servers`) for discovery.
  - Source: [MCP Registry GitHub](https://github.com/modelcontextprotocol/registry)

---

## 6. Jina Reader API Best Practices

### Configuration

Key request headers for optimal documentation extraction:
- `X-Return-Format: markdown` -- Returns clean Markdown (default)
- `X-Exclude-Selector: nav,footer,aside,.sidebar,.ads` -- Strips navigation chrome
- `X-Wait-For-Selector: main,article,.docs-content,[role=main]` -- Waits for content to render (critical for SPAs)
- `x-timeout` -- Extend render wait time for slow-loading pages
- `x-with-generated-alt: true` -- AI-generated alt text for images

GroundTruth already uses the first three headers in `fetchViaJina`.

### Rate Limits and Pricing

- Free tier available for basic usage
- API key required for higher rate limits (charged by content-length tokens)
- New pricing model since May 2025 -- existing users grandfathered on old pricing
- Cookie forwarding (`x-set-cookie`) disables caching, making authenticated reads slower

### MCP Server Transport

The official Jina MCP server uses Streamable HTTP transport (MCP spec 2025-03-26), not the deprecated SSE transport. Claude Code has native support for both.

### Filtering Tools to Save Context

Jina's MCP server supports `exclude_tags`, `include_tags`, and `exclude_tools` query parameters on the endpoint URL. Every registered MCP tool consumes context window tokens -- filtering unused tools server-side saves meaningful token budget.
  - Source: [Jina Reader API](https://jina.ai/reader/)
  - Source: [Jina MCP GitHub](https://github.com/jina-ai/MCP)

### When to Use Jina vs. Direct Fetch

- **Direct fetch:** Public HTML pages, static documentation sites, llms.txt files
- **Jina Reader:** JavaScript-rendered pages, SPAs, sites with anti-bot protection (basic), pages requiring CSS rendering for content visibility
- **Playwright/browser automation:** Authentication flows, form submissions, complex interaction

GroundTruth's dual-path approach (direct HTML first, Jina fallback) is the recommended pattern.
  - Source: [Jina AI Reader Deep Dive](https://skywork.ai/skypage/en/jina-ai-reader-deep-dive/1977985446337515520)

---

## 7. npm MCP Server Publishing Best Practices

### package.json Configuration

Essential fields for an npm-published MCP server:

```json
{
  "name": "@scope/package-name",
  "type": "module",
  "bin": { "my-mcp-server": "dist/index.js" },
  "files": ["dist/", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "prepublishOnly": "npm run build"
}
```

The `bin` field enables `npx -y @scope/package-name` execution -- the standard way MCP clients invoke servers.

### MCP Registry Integration

For listing on the official MCP Registry:
- Add `mcpName` property to `package.json` (must match `name` in `server.json`)
- The MCP Registry only hosts metadata -- publish to npm first
- Include a `server.json` manifest file

### Release Process

Peter Steinberger's recommended workflow:
1. Beta release first: `npm publish --tag beta`
2. Test via `npx @scope/package-name@beta`
3. Promote to latest: `npm dist-tag add @scope/package-name@x.y.z latest`
4. Run `npm audit` before every deploy
5. Use `npm ci` / `pnpm install --frozen-lockfile` in CI

### Version Synchronization

Both Peter Steinberger and GroundTruth emphasize that `SERVER_VERSION` in code must match `package.json` version. GroundTruth uses the `version` npm lifecycle script to auto-sync -- this is the recommended approach.
  - Source: [Peter Steinberger MCP Best Practices](https://steipete.me/posts/2025/mcp-best-practices)
  - Source: [MCP Registry Quickstart](https://modelcontextprotocol.io/registry/quickstart)
  - Source: [Building MCP Server Guide](https://www.geeky-gadgets.com/building-mcp-server-guide/)

### Minimal Package Contents

The published npm package should contain only: `dist/`, `README.md`, `LICENSE`, and any native binaries. Use the `files` field in `package.json` to control this. Never include `src/`, `test/`, `.env`, or `docs/private/`.

### Shebang Line

The entry point file (`dist/index.js`) needs `#!/usr/bin/env node` at the top for the `bin` field to work correctly with `npx`.

---

## 8. How Context7, Cursor, and Similar Tools Handle Library Lookups

### Context7 (Upstash)

**Architecture:** Two-step resolution pipeline.
1. `resolve-library-id` -- Fuzzy-matches a library name against a 9,000+ library database. Returns a Context7 ID (e.g., `/vercel/next.js`). Ranked by trust score and documentation coverage.
2. `query-docs` -- Fetches documentation chunks for a resolved library ID. Supports optional topic filter and configurable token limits (default 5,000).

**Key design decisions:**
- The resolution step is mandatory -- prevents hallucinated library IDs
- Backend (API, parsing engine, crawling engine) is private/proprietary
- MCP server source code is open
- No authentication required for basic usage; optional API key for higher rate limits
- Remote HTTP transport is default; stdio for local development

**How it differs from GroundTruth:**
- Context7 has a much larger library database (9,000+ vs. 422+) but it's proprietary
- Context7 serves pre-indexed, chunked documentation; GroundTruth fetches live
- Context7 requires internet connection to its API backend; GroundTruth can work with cached content offline
- GroundTruth provides richer tool surface (audit, compare, migration, best-practices, examples)
  - Source: [Context7 GitHub](https://github.com/upstash/context7)
  - Source: [Context7 MCP Blog](https://upstash.com/blog/context7-mcp)

### Cursor

Cursor does not have a built-in library documentation MCP. Instead:
- It provides the MCP framework that allows tools like Context7 to plug in
- MCP servers are configured via `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)
- Server failures are isolated -- one crashing server doesn't affect others
- The Composer Agent automatically uses MCP tools when relevant
- "Yolo mode" allows auto-running MCP tools without approval
  - Source: [Cursor MCP Docs](https://cursor.com/docs/mcp)

### Claude Code

Claude Code has native MCP support with both stdio and Streamable HTTP transports. It uses connected MCP servers' tools as part of its unified tool registry. The GroundTruth MCP server is specifically designed for this use case.

### Dynamic Toolset Discovery (GitHub MCP Pattern)

GitHub's MCP server introduced "dynamic toolset discovery" -- instead of loading all tools at startup, the host discovers and enables toolsets in response to the user's prompt. This prevents the model from getting confused by too many available tools.
  - Source: [GitHub MCP Server](https://github.com/mcp/github/github-mcp-server)

---

## Data and Statistics

- Context7 indexes 9,000+ libraries and frameworks -- Source: [Context7 GitHub](https://github.com/upstash/context7)
- Block has developed 60+ internal MCP servers -- Source: [Block Engineering Blog](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)
- GroundTruth maintains 97 public / 422+ private registry entries across 770 tests
- MCP spec updates: March 2025 (OAuth 2.1 mandatory), June 2025 (outputSchema, structuredContent, transport cancellation) -- Source: [The New Stack](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)
- Jina Reader processes pages through browser rendering; 25s timeout is recommended for documentation sites
- llms.txt adoption: thousands of sites via Mintlify/Fern; zero visits from major AI crawlers (general inference), but active use by coding assistants -- Source: [llmstxt.org](https://llmstxt.org/)
- Claude 3.7 Sonnet: 200K input token max; even large-window models see performance drops with excessive context -- Source: [Block Engineering](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)

---

## Considerations

1. **llms.txt is not universal** -- Many libraries still lack llms.txt files. Dynamic fallback chains remain necessary. Auto-discovery (trying `{origin}/llms.txt`) is a low-cost hedge.

2. **Jina Reader rate limits** -- The free tier is rate-limited. For production MCP servers, either use an API key or implement the dual-path (direct fetch first, Jina fallback) pattern that GroundTruth already uses.

3. **Registry maintenance burden** -- A static registry of 422+ entries requires ongoing updates. Consider supplementing with automated npm/PyPI metadata enrichment.

4. **Context window pressure** -- Every MCP tool registration consumes tokens (tool name, description, parameter schema). With 6 tools, GroundTruth is well within the recommended "bounded toolset" range. Context7's approach of only 2 tools is even more conservative.

5. **MCP spec evolution** -- The June 2025 spec added `outputSchema`/`structuredContent`, which GroundTruth should consider adopting for dual-format responses.

6. **Security of fetched content** -- GroundTruth's `INJECTION_PATTERNS` for prompt injection detection in fetched content is a forward-thinking pattern not widely adopted yet. This becomes more important as MCP servers are used in agentic workflows.

7. **Obfuscation trade-off** -- The build pipeline obfuscates `dist/` to protect the private registry data. This is unusual for npm packages and may complicate debugging for users, but is justified given the proprietary registry content.

---

## Recommendations

1. **Adopt structured content responses** -- Implement the MCP June 2025 `outputSchema`/`structuredContent` fields to provide JSON for the model and Markdown for the human simultaneously.

2. **Add token-budget-aware caching** -- Cache pre-truncated content at common token limits (5K, 8K, 15K) to avoid re-processing the same content at different budget levels.

3. **Expand auto-discovery** -- When a library isn't in the registry, automatically try npm/PyPI metadata to find homepage/repository URLs, then attempt llms.txt discovery on those domains.

4. **Consider sitemap-driven deep fetch** -- For libraries with rich documentation sites but no llms.txt, parse their `sitemap.xml` to discover all doc pages, rank by topic relevance, and fetch the top matches. GroundTruth already has `fetchSitemapUrls` -- consider exposing this more prominently in the tool pipeline.

5. **Implement tool annotations** -- Add `readOnlyHint: true` to all GroundTruth tools (they're all read-only) and `idempotentHint: true` where applicable. This helps clients optimize retry behavior.

6. **Monitor Jina Reader availability** -- Add metrics/logging for Jina Reader success/failure rates to track whether the circuit breaker is triggering frequently and whether the free tier is sufficient.

7. **Publish to the MCP Registry** -- Add `mcpName` to `package.json` and create a `server.json` manifest for listing on `registry.modelcontextprotocol.io`.

---

## Sources

1. [llmstxt.org -- The /llms.txt file specification](https://llmstxt.org/)
2. [Mintlify -- llms.txt documentation](https://www.mintlify.com/docs/ai/llmstxt)
3. [Fern -- llms.txt and llms-full.txt](https://buildwithfern.com/learn/docs/ai-features/llms-txt)
4. [Context7 GitHub Repository](https://github.com/upstash/context7)
5. [Context7 MCP Blog -- Upstash](https://upstash.com/blog/context7-mcp)
6. [Block's Playbook for Designing MCP Servers](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)
7. [Phil Schmid -- MCP is Not the Problem, It's Your Server](https://www.philschmid.de/mcp-best-practices)
8. [Peter Steinberger -- MCP Best Practices](https://steipete.me/posts/2025/mcp-best-practices)
9. [The New Stack -- 15 Best Practices for Building MCP Servers in Production](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)
10. [MCP Best Practices Architecture Guide](https://modelcontextprotocol.info/docs/best-practices/)
11. [MCP Best Practice Community Guide](https://mcp-best-practice.github.io/mcp-best-practice/best-practice/)
12. [NearForm -- Implementing MCP: Tips, Tricks, and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/)
13. [Jina Reader API](https://jina.ai/reader/)
14. [Jina MCP Server GitHub](https://github.com/jina-ai/MCP)
15. [Jina AI Reader Deep Dive](https://skywork.ai/skypage/en/jina-ai-reader-deep-dive/1977985446337515520)
16. [Stainless -- Error Handling and Debugging MCP Servers](https://www.stainless.com/mcp/error-handling-and-debugging-mcp-servers)
17. [MCPcat -- Error Handling in MCP Servers](https://mcpcat.io/guides/error-handling-custom-mcp-servers/)
18. [Mastering Zod Validation in MCP Servers](https://sko.kr/en/blog/zod-for-mcp)
19. [Advanced Caching Strategies for MCP Servers](https://medium.com/@parichay2406/advanced-caching-strategies-for-mcp-servers-from-theory-to-production-1ff82a594177)
20. [FastMCP Caching Middleware](https://gofastmcp.com/python-sdk/fastmcp-server-middleware-caching)
21. [mcp-cache Proxy Server](https://lobehub.com/mcp/swapnilsurdi-mcp-cache)
22. [MCP Registry Quickstart](https://modelcontextprotocol.io/registry/quickstart)
23. [MCP Registry GitHub](https://github.com/modelcontextprotocol/registry)
24. [Cursor MCP Documentation](https://cursor.com/docs/mcp)
25. [GitHub MCP Server](https://github.com/mcp/github/github-mcp-server)
26. [Spring AI MCP Graceful Degradation Issue](https://github.com/spring-projects/spring-ai/issues/3232)
27. [Smithery Error Recovery Skill](https://smithery.ai/skills/tianzecn/error-recovery)
28. [MCP Server Development Guide](https://github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-server-development-guide.md)
29. [Gravitee -- MCP API Gateway Caching](https://www.gravitee.io/blog/mcp-api-gateway-explained-protocols-caching-and-remote-server-integration)
30. [Edge MCP Server Tool Design](https://glama.ai/blog/2025-08-22-agent-workflows-and-tool-design-for-edge-mcp-servers)
