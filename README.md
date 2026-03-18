# ws-mcp

Universal documentation and best practices MCP server for Claude Code, Cursor, and any MCP-compatible AI client.

Fetches live content from official sources — llms.txt files, official docs, GitHub READMEs — so your AI assistant always has current information, not stale training data.

**230+ libraries covered.** No API key. No rate limits. Auto-updates when you run it.

---

## Install

### Claude Code

```bash
claude mcp add ws -- npx -y ws-mcp@latest
```

### Cursor / VS Code / Claude Desktop

Add to your MCP config file:

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

That's it. No build step, no global install. Updates automatically when a new version is published.

---

## Tools

### `ws_resolve_library`
Resolve a library name to its docs URL and registry ID. Call this first when you know the library name.

```
ws_resolve_library({ libraryName: "nextjs" })
ws_resolve_library({ libraryName: "drizzle" })
```

### `ws_get_docs`
Fetch up-to-date documentation for any library, filtered by topic.

```
ws_get_docs({ libraryId: "vercel/next.js", topic: "caching" })
ws_get_docs({ libraryId: "facebook/react", topic: "server components" })
```

### `ws_best_practices`
Fetch patterns, anti-patterns, and configuration guidance for a library.

```
ws_best_practices({ libraryId: "vercel/next.js" })
ws_best_practices({ libraryId: "tailwindcss/tailwindcss", topic: "dark mode" })
```

### `ws_auto_scan`
Detect all dependencies from `package.json`, `requirements.txt`, `Cargo.toml`, or `go.mod` and fetch best practices for each.

```
ws_auto_scan({})
ws_auto_scan({ projectPath: "/path/to/project" })
```

### `ws_search`
Freeform search across web standards, security, accessibility, performance, and any topic. No library name needed.

```
ws_search({ query: "OWASP SQL injection prevention" })
ws_search({ query: "WCAG 2.2 focus indicators" })
ws_search({ query: "Core Web Vitals LCP optimization" })
ws_search({ query: "JWT security best practices" })
```

### `ws_audit`
Scan your actual source files for real issues — layout shifts, performance problems, accessibility violations, security gaps, React/Next.js patterns, TypeScript errors. Returns file and line locations with live fixes from official docs.

```
ws_audit({ projectPath: "." })
ws_audit({ projectPath: ".", categories: ["security", "accessibility"] })
```

Categories: `layout`, `performance`, `accessibility`, `security`, `react`, `nextjs`, `typescript`, `all`

---

## How it works

For each library lookup, the server tries sources in this order:

1. **llms.txt** — official, AI-optimized documentation published by the library itself
2. **llms-full.txt** — extended version if available
3. **Jina Reader** — renders JavaScript-heavy docs pages
4. **GitHub README + releases** — fallback for any npm or PyPI package

For `ws_search`, it maps topics to authoritative sources (MDN, OWASP, web.dev, W3C, WCAG) and falls back to DuckDuckGo.

For `ws_audit`, it scans your source files with pattern matching, then fetches live fixes from the same official sources.

---

## Auto-updates

Using `npx -y ws-mcp@latest` means every run checks npm for the latest version. When you update the server and publish a new version, all users get it automatically on their next session — no manual update step.

---

## Requirements

- Node.js 20+
- An MCP-compatible client (Claude Code, Cursor, VS Code with MCP extension, Claude Desktop)

---

## Why not Context7?

| | ws-mcp | Context7 |
|---|---|---|
| Rate limits | None | Yes |
| Source priority | llms.txt first | Embeddings |
| Code audit | Yes (file:line) | No |
| Self-hosted | Yes | No |
| Libraries | 230+ | 130+ |
| API key needed | No | No |
| PyPI support | Yes | Limited |

---

## License

MIT — [Senorit](https://senorit.de)
