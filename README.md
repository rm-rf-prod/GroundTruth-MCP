<p align="center">
  <img src="./banner.webp" alt="ws-mcp banner" width="100%" />
</p>

<h1 align="center">ws-mcp</h1>

<p align="center">
  Universal documentation and best practices MCP server for Claude Code, Cursor, and any MCP-compatible AI client.<br/>
  Fetches live content from official sources — <strong>no stale training data, no rate limits, no API key</strong>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ws-mcp"><img src="https://img.shields.io/npm/v/ws-mcp?color=00d4aa&label=npm" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/libraries-230%2B-teal" alt="230+ libraries" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node 20+" />
</p>

---

## Why I built this

I use Claude Code heavily for production work across Next.js, Supabase, Drizzle, Tailwind, and a dozen other libraries. The problem I kept running into was simple: **Claude's training data is always months behind.**

When I asked about Next.js 16's `proxy.ts`, it described `middleware.ts`. When I asked about AI SDK v6's `useChat`, it gave me the v5 API. When I needed the latest Drizzle ORM patterns, it gave me deprecated syntax. The knowledge cutoff isn't a small gap — for fast-moving libraries it's the difference between code that ships and code that breaks.

The obvious fix is Context7, an MCP server that fetches current docs. I used it for a while. Then I started hitting rate limits during long sessions. Then I noticed it had around 130 libraries in its registry. Then I saw it was returning chunked embeddings rather than the actual structured content from official docs.

So I built ws-mcp.

It solves the same problem differently:
- **Self-hosted** — runs on your machine, no shared infrastructure, no rate limits ever
- **230+ libraries** — curated registry with the right docs URL and llms.txt path for each one
- **Source priority that makes sense** — llms.txt files first, because library authors write those specifically for AI assistants. Embeddings of old docs pages last.
- **An audit tool** — scans your actual source files for real issues with file and line numbers, then fetches live fixes from official docs. Context7 has nothing like this.
- **Freeform search** — look up OWASP, WCAG, MDN, web standards, security topics. Not just library docs.

---

## Install

### Claude Code

```bash
claude mcp add ws -- npx -y ws-mcp@latest
```

### Cursor / Claude Desktop / VS Code

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, or `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "ws": {
      "command": "npx",
      "args": ["-y", "ws-mcp@latest"]
    }
  }
}
```

No build step. No global install. Node 20+ required. Updates automatically — explained below.

---

## How it works

When you ask your AI client to "use ws" or call any `ws_*` tool, here is exactly what happens:

```
1. ws_resolve_library("drizzle")
       │
       ├─ Check internal registry (230+ curated entries)
       │   → matches drizzle-orm entry
       │   → returns id, docsUrl, llmsTxtUrl, githubUrl
       │
2. ws_get_docs / ws_best_practices
       │
       ├─ Step 1: fetch https://orm.drizzle.team/llms.txt
       │          (official, written by library authors for AI)
       │
       ├─ Step 2: fetch https://orm.drizzle.team/llms-full.txt
       │          (extended version if available)
       │
       ├─ Step 3: fetch via Jina Reader (https://r.jina.ai/...)
       │          (renders JavaScript-heavy docs pages to clean text)
       │
       └─ Step 4: fetch GitHub README + latest release notes
                  (fallback, always works)
       │
3. Content returned to your AI client
       → AI answers with current, official information
```

For libraries **not in the registry**, the server falls back to the npm or PyPI registry to find the homepage URL, then applies the same 4-step chain. This means it works for any package, not just the 230+ curated ones.

For **`ws_audit`**, it reads your actual source files, runs pattern matching per category (layout, performance, accessibility, security, React, Next.js, TypeScript), collects every hit with its file path and line number, then fetches live fixes from official docs for each issue type. You get a structured report you can act on immediately.

For **`ws_search`**, it maps topics to authoritative sources directly — OWASP for security, MDN for web APIs, web.dev for performance, W3C and WCAG for standards — and falls back to DuckDuckGo for anything outside those categories.

Everything runs locally on stdio transport. No data leaves your machine except the outbound fetch requests to official docs sites.

---

## Tools

### `ws_resolve_library`

Resolve a library name to its docs URL and internal registry ID. Always call this first when you know the library name.

```
"use ws for nextjs"         → resolves to vercel/next.js
"use ws for drizzle orm"    → resolves to drizzle-team/drizzle-orm
"use ws for fastapi"        → resolves to tiangolo/fastapi (PyPI fallback)
"use ws for some-new-lib"   → resolves via npm registry fallback
```

### `ws_get_docs`

Fetch current documentation for a specific topic within a library.

```
ws_get_docs({ libraryId: "vercel/next.js", topic: "caching" })
ws_get_docs({ libraryId: "facebook/react", topic: "server components" })
ws_get_docs({ libraryId: "tailwindcss/tailwindcss", topic: "dark mode" })
```

### `ws_best_practices`

Fetch patterns, anti-patterns, and configuration guidance. Useful before starting implementation of anything non-trivial.

```
ws_best_practices({ libraryId: "vercel/next.js" })
ws_best_practices({ libraryId: "supabase/supabase", topic: "row level security" })
ws_best_practices({ libraryId: "drizzle-team/drizzle-orm", topic: "migrations" })
```

### `ws_auto_scan`

Detect all project dependencies from `package.json`, `requirements.txt`, `Cargo.toml`, or `go.mod` and fetch best practices for each one automatically. Useful at the start of a session on an unfamiliar codebase.

```
ws_auto_scan({})
ws_auto_scan({ projectPath: "/path/to/project" })
```

### `ws_search`

Freeform search across web standards, security, accessibility, and performance topics. No library name needed.

```
ws_search({ query: "OWASP SQL injection prevention 2026" })
ws_search({ query: "WCAG 2.2 focus indicators" })
ws_search({ query: "Core Web Vitals LCP optimization" })
ws_search({ query: "JWT vs session cookies security" })
ws_search({ query: "HTTP/3 QUIC browser support" })
```

Covered sources: MDN, OWASP, web.dev, W3C, WCAG, CSS-Tricks, Node.js docs, and more.

### `ws_audit`

The tool that doesn't exist anywhere else. Scans your actual source files for real issues — not hypothetical ones — and returns file paths with line numbers plus live fixes from official docs.

```
ws_audit({ projectPath: "." })
ws_audit({ projectPath: ".", categories: ["security", "accessibility"] })
```

**Categories:**

| Category | What it checks |
|---|---|
| `layout` | Layout shifts, missing image dimensions, CLS issues |
| `performance` | Bundle size, lazy loading, resource hints, render-blocking |
| `accessibility` | Missing alt text, unlabelled inputs, poor contrast, ARIA misuse |
| `security` | Hardcoded secrets, unsafe innerHTML, missing CSP, CORS misconfig |
| `react` | Missing keys, stale closures, effect cleanup, prop drilling |
| `nextjs` | Deprecated APIs, sync request access, missing Suspense boundaries |
| `typescript` | `any` usage, non-null assertions, missing return types |
| `all` | Everything above (default) |

---

## Auto-updates

The install command uses `npx -y ws-mcp@latest`. Every time your AI client starts a new session, npx checks npm for the latest published version. If a newer version exists, it downloads and runs it. If the cached version is already current, it starts instantly from cache.

This means: when I improve the library registry, add new tools, or fix a bug and run `npm publish`, every user gets the update on their next session. No manual steps, no notifications, no opt-in.

---

## vs. Context7

| | ws-mcp | Context7 |
|---|---|---|
| Hosting | Self-hosted (your machine) | Cloud service |
| Rate limits | None | Yes (shared infrastructure) |
| Source priority | llms.txt → Jina → GitHub | Embeddings of docs pages |
| Code audit tool | Yes — file:line with live fixes | No |
| Freeform search | Yes — OWASP, MDN, web standards | Library docs only |
| Libraries | 230+ curated + npm/PyPI fallback | ~130 |
| Python / Rust / Go | Yes | Limited |
| API key | Not required | Not required |
| Offline | No (fetches live) | No |

Context7 is a good project. This one just fits my workflow better.

---

## Requirements

- Node.js 20+
- An MCP-compatible client: Claude Code, Cursor, VS Code with MCP extension, or Claude Desktop

---

## License

MIT — [Senorit](https://senorit.de)
