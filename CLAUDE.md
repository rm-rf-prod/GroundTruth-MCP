# WS MCP Server

**Package:** `@senorit/ws-mcp` — npm published, self-hosted MCP server
**Repo:** `git@github.com:rm-rf-prod/ws-mcp.git`
**Node:** 24.13.0 (see `.node-version`)

---

## Global Rules

@~/.claude/rules/typescript-strict.md
@~/.claude/rules/security.md
@~/.claude/rules/git-workflow.md
@~/.claude/rules/testing.md
@~/.claude/rules/ci-cd.md

---

## Project Info

| Key | Value |
|-----|-------|
| npm package | `@senorit/ws-mcp` |
| Current version | `1.9.0` |
| Tests | 402 across 15 files |
| Registry entries | 25 public (full 230+ private, compiled into dist) |
| License | Elastic-2.0 |
| Module system | ESM (`"type": "module"`) |
| TypeScript | 5.9.3, strict mode, Node16 module resolution |
| Test runner | Vitest 4.x |
| MCP SDK | `@modelcontextprotocol/sdk` |

---

## Architecture

```
src/
  index.ts              — Entry point, MCP server bootstrap, stdio transport
  constants.ts          — SERVER_NAME, SERVER_VERSION, all URL constants, INJECTION_PATTERNS
  types.ts              — Shared TypeScript types (LibraryEntry, etc.)
  tools/                — One file per MCP tool (6 tools)
    resolve.ts          — ws_resolve_library
    docs.ts             — ws_get_docs
    best-practices.ts   — ws_best_practices
    auto-scan.ts        — ws_auto_scan (reads package.json/requirements.txt/etc.)
    search.ts           — ws_search (MDN, OWASP, web.dev, freeform)
    audit.ts            — ws_audit (scans source files for issues)
  sources/
    registry.ts         — LIBRARY_REGISTRY (25 public entries — full 230+ in private build)
  services/
    fetcher.ts          — HTTP fetching with timeout, retries, Jina Reader fallback
    cache.ts            — Disk cache (~/.ws-mcp-cache, 30min TTL)
  utils/
    extract.ts          — Token extraction, content trimming
    guard.ts            — Prompt injection detection (INJECTION_PATTERNS)
    sanitize.ts         — Content sanitization
    watermark.ts        — Response watermarking
```

---

## The 6 MCP Tools

| Tool | Purpose |
|------|---------|
| `ws_resolve_library` | Resolve library name → WS ID + docs URL (call this first) |
| `ws_get_docs` | Fetch docs for a library filtered by topic |
| `ws_best_practices` | Fetch patterns, anti-patterns, config for a library |
| `ws_auto_scan` | Detect all deps from package.json/requirements.txt/etc., fetch best practices |
| `ws_search` | Freeform search — MDN, OWASP, web.dev, W3C, DuckDuckGo fallback |
| `ws_audit` | Scan source files for real issues, fetch live fixes from official docs |

---

## Build & Obfuscation

The build pipeline is **two-stage**:

1. **TypeScript compile** — `tsc` outputs to `dist/`
2. **Obfuscation** — `javascript-obfuscator` runs over `dist/`, in-place

```bash
npm run build
# = tsc && javascript-obfuscator dist --output dist --compact true --string-array true
```

**Why obfuscation:** The published npm package contains the full 230+ library registry (privately maintained). Obfuscation prevents trivial extraction of the registry data while keeping the package usable.

**IMPORTANT:** `dist/` is obfuscated — never debug from `dist/`. Always read source from `src/`. During development use `npm run dev` (tsx watch, no obfuscation).

---

## Registry — Public vs Private

- `src/sources/registry.ts` — **25 public example entries** (what's in the repo)
- **Full 230+ entry registry** is maintained separately and compiled into the published npm package at build time
- The public registry demonstrates the schema for contributors
- Do NOT add more than ~30 entries to the public registry — keep the distinction clear

### Adding a library (public registry)
Every entry needs at minimum: `id`, `name`, `docsUrl`. Recommended: `llmsTxtUrl`, `aliases`, `bestPracticesPaths`.

---

## Version Sync (CRITICAL)

`SERVER_VERSION` in `src/constants.ts` MUST always match `version` in `package.json`.

**Auto-sync is wired:** the `version` npm lifecycle script updates `constants.ts` automatically when you run `npm version X.Y.Z`. It then stages `src/constants.ts` for the version commit.

**Manual sync check:**
```bash
node -e "const p=require('./package.json');const c=require('fs').readFileSync('src/constants.ts','utf8');console.log(c.match(/SERVER_VERSION = \"([^\"]+)\"/)[1]===p.version?'IN SYNC':'OUT OF SYNC: constants='+c.match(/SERVER_VERSION = \"([^\"]+)\"/)[1]+' pkg='+p.version)"
```

---

## Commands

```bash
npm run dev              # tsx watch — dev server, no obfuscation
npm run build            # tsc + obfuscate → dist/
npm run start            # node dist/index.js (obfuscated)
npm run test             # vitest run (402 tests)
npm run test:coverage    # vitest run --coverage → coverage/
npm run typecheck        # tsc --noEmit
npm run clean            # rm -rf dist
```

---

## Publishing Workflow

```bash
# 1. Bump version (auto-syncs constants.ts)
npm version patch   # or minor / major

# 2. Verify
npm run typecheck
npm run test
npm run build
npm audit --audit-level=high

# 3. Publish
npm publish --access public

# 4. GitHub release
gh release create vX.Y.Z --title "vX.Y.Z — description" --notes "..."
```

`prepublishOnly` automatically runs `clean + build` before every publish.

---

## MCP Registration

Registered in `~/.claude.json` as the `ws` server:
```json
{
  "ws": {
    "type": "stdio",
    "command": "node",
    "args": ["/home/senorit/projects/ws-mcp-server/dist/index.js"]
  }
}
```

After any code changes: rebuild (`npm run build`) and restart Claude Code for the new dist to take effect.

---

## Testing Notes

- **402 tests** across 15 files (all colocated `*.test.ts` next to source)
- Coverage excludes `src/index.ts` (entry point — tested via integration)
- `vi.hoisted()` is used in `index.test.ts` to spy on `process.exit` before module load
- All mocks are hoisted at the top of each test file before imports
- Pool: `forks` (avoids ESM shared-state issues between test files)

---

## Security

- **Prompt injection guard** — `INJECTION_PATTERNS` in `constants.ts` strips LLM instruction attempts from all fetched external content before returning to the model
- **Input validation** — all tool inputs validated with Zod schemas
- **No user secrets** — the server fetches only public documentation URLs
- Never add `eval()`, dynamic `require()`, or shell exec in any fetch/parse path

---

## CI/CD (GitHub Actions)

Three jobs run on every push/PR to `main`:

| Job | What it does |
|-----|-------------|
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run --coverage`, uploads coverage artifact |
| `build` | `tsc + obfuscator + npm audit`, uploads dist artifact |

Build depends on both typecheck and test passing first.

---

## Decisions

### 2026-03-18 — Project setup
- Moved from `~/ws-mcp-server/` to `~/projects/ws-mcp-server/` to live with other projects
- Added `version` npm lifecycle hook for automatic constants.ts sync
- Fixed SERVER_VERSION mismatch: was 1.1.0, now correctly 1.9.0

### 2026-03-18 — v1.9.0 release
- 402 tests across 15 files (complete coverage)
- `vi.hoisted()` fix for process.exit unhandled error in index.test.ts
- GitHub Actions CI with 3 jobs
- npm published, GitHub release created
