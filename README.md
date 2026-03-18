<p align="center">
  <img src="./banner.webp" alt="ws-mcp" width="100%" />
</p>

<h1 align="center">ws-mcp</h1>

<p align="center">
  MCP server that fetches live documentation from official sources.<br/>
  Self-hosted. No rate limits. 230+ libraries.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@senorit/ws-mcp"><img src="https://img.shields.io/npm/v/@senorit/ws-mcp?color=00d4aa&label=npm" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-ELv2-orange" alt="Elastic License 2.0" /></a>
  <img src="https://img.shields.io/badge/libraries-230%2B-teal" alt="230+ libraries" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node 20+" />
</p>

---

## Install

### Claude Code

```bash
claude mcp add ws -- npx -y @senorit/ws-mcp@latest
```

### Cursor / Claude Desktop / VS Code

Add to your MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, or `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "ws": {
      "command": "npx",
      "args": ["-y", "@senorit/ws-mcp@latest"]
    }
  }
}
```

No build step required. Node.js 20+ only.

---

## What it does

ws-mcp adds six tools to your AI client that fetch current, authoritative documentation at query time — not from training data.

| Tool | What it does |
|---|---|
| `ws_resolve_library` | Maps a library name to its registry entry |
| `ws_get_docs` | Fetches current docs for a specific topic within a library |
| `ws_best_practices` | Fetches patterns, anti-patterns, and configuration guidance |
| `ws_auto_scan` | Reads your package.json / requirements.txt and fetches best practices per dependency |
| `ws_search` | Freeform search across OWASP, MDN, web.dev, W3C, WCAG, and more |
| `ws_audit` | Scans your actual source files for issues with file:line locations and live fix references |

---

## Usage

### Natural language (recommended)

```
use ws for nextjs
use ws for drizzle migrations
ws audit
use ws to check WCAG focus indicators
use ws for security
```

### Direct tool calls

```typescript
ws_resolve_library({ libraryName: "drizzle" })
ws_get_docs({ libraryId: "drizzle-team/drizzle-orm", topic: "migrations" })
ws_best_practices({ libraryId: "vercel/next.js", topic: "caching" })
ws_auto_scan({ projectPath: "." })
ws_search({ query: "OWASP SQL injection prevention 2025" })
ws_audit({ projectPath: ".", categories: ["security", "accessibility"] })
```

---

## `ws_audit` — code audit tool

Scans your actual source files for real issues. Returns file paths with line numbers and fetches live fixes from official docs.

```
ws_audit({ projectPath: "." })
ws_audit({ projectPath: ".", categories: ["security", "accessibility"] })
```

| Category | What it checks |
|---|---|
| `layout` | Layout shifts, missing image dimensions, CLS |
| `performance` | Bundle size, lazy loading, resource hints, render-blocking |
| `accessibility` | Missing alt text, unlabelled inputs, ARIA misuse |
| `security` | Hardcoded secrets, unsafe innerHTML, CORS misconfiguration |
| `react` | Missing keys, stale closures, effect cleanup |
| `nextjs` | Deprecated APIs, sync request access, missing Suspense boundaries |
| `typescript` | `any` usage, non-null assertions, missing return types |
| `all` | Everything above (default) |

---

## `ws_search` — freeform search

Works for anything that has no npm package — web standards, security specs, protocols, browser APIs.

```
ws_search({ query: "WCAG 2.2 focus indicators" })
ws_search({ query: "JWT vs session cookies security" })
ws_search({ query: "Core Web Vitals LCP optimization" })
ws_search({ query: "CSS container queries browser support" })
```

Sources: OWASP, MDN, web.dev, W3C, WCAG, Node.js docs, and more.

---

## Auto-updates

The install command uses `npx -y @senorit/ws-mcp@latest`. On every session start, npx checks npm for the latest version. If a newer release is available, it downloads and runs it automatically. No manual steps required.

---

## vs. Context7

| | ws-mcp | Context7 |
|---|---|---|
| Hosting | Your machine | Cloud service |
| Rate limits | None | Yes (shared infrastructure) |
| Source priority | llms.txt → Jina → GitHub | Embeddings of doc pages |
| Code audit tool | Yes — file:line + live fixes | No |
| Freeform search | Yes — OWASP, MDN, standards | Library docs only |
| Libraries | 230+ curated + npm/PyPI fallback | ~130 |
| Python / Rust / Go | Yes | Limited |
| API key required | No | No |

---

## Requirements

- Node.js 20+
- Claude Code, Cursor, VS Code (with MCP extension), or Claude Desktop

---

## Contributing

The library registry lives in `src/sources/registry.ts`. To add a library, open a PR with the entry: `id`, `name`, `docsUrl`, and `llmsTxtUrl` if the project publishes one.

Bug reports and feature requests: [GitHub Issues](https://github.com/rm-rf-prod/ws-mcp/issues)

---

## License

[Elastic License 2.0](./LICENSE) — free to use and self-host. You may not offer it as a managed service or build a competing product from it.
