# Security Policy

## Supported Versions

Only the latest published release receives security fixes.

| Version      | Supported |
|--------------|-----------|
| 7.x (latest) | Yes       |
| < 7.0        | No        |

## Scope

GroundTruth (`@groundtruth-mcp/gt-mcp`) is an MCP server that fetches public documentation at query time. By default it runs as a local stdio process started by your MCP client. Setting `GT_HTTP_PORT` switches it to an optional Streamable HTTP mode for self-hosting, which the Docker image uses. It does not store credentials and does not connect to any backend service controlled by us.

In scope for security reports:

- Prompt injection via fetched external content reaching the model
- Path traversal or arbitrary file read through `gt_audit`, `gt_auto_scan` or the `projectPath` inputs
- SSRF: making the server fetch private, loopback or link-local addresses
- HTTP mode: bearer-token bypass, Host/Origin (DNS-rebinding) check bypass, session confusion between clients
- Remote code execution via crafted registry or documentation responses
- Token or secret leakage through `GT_GITHUB_TOKEN`, `GT_AUTH_TOKEN` or other environment variables
- Dependency vulnerabilities with a realistic exploit path

Out of scope:

- Rate limiting or abuse of third-party documentation sources (report to them directly)
- Issues in the model or MCP client you connect GroundTruth to
- A tokenless loopback bind that was exposed to other hosts, for example through a reverse proxy or port forward (set `GT_AUTH_TOKEN` on any deployment others can reach)
- Theoretical vulnerabilities with no practical impact

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub Security Advisories:
[github.com/rm-rf-prod/GroundTruth-MCP/security/advisories/new](https://github.com/rm-rf-prod/GroundTruth-MCP/security/advisories/new)

Include:

- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- A suggested fix if you have one

You can expect an initial response within 48 hours. If the issue is confirmed, a patch will be released as soon as possible and you will be credited in the release notes unless you prefer otherwise.

## HTTP Deployment

HTTP mode serves `/mcp`, `/health` and `/metrics`. Its defaults:

- **Bind address**: `127.0.0.1` unless `GT_HTTP_HOST` says otherwise. The Docker image sets `GT_HTTP_HOST=0.0.0.0` because a container has to listen beyond loopback, so it will not start without `GT_AUTH_TOKEN`.
- **Authentication**: when `GT_AUTH_TOKEN` is set, every path, `/health` and `/metrics` included, requires `Authorization: Bearer <token>`. The comparison is constant-time over SHA-256 digests, so neither the token nor its length leaks through timing. A rejected request gets `401` with `WWW-Authenticate: Bearer`. Without a token the server refuses to start on any non-loopback address (it logs an error and exits with status 1). On loopback it starts open and logs a warning.
- **DNS-rebinding protection**: a request whose `Origin` header is present but not a loopback hostname or one listed in `GT_HTTP_ALLOWED_HOSTS` gets `403`. The `Host` header is checked against the same list when the server is bound to loopback or when `GT_HTTP_ALLOWED_HOSTS` is set. On a public bind without that list, any `Host` is accepted, and the token is the only gate.
- **Sessions**: stateless by default. With `GT_HTTP_STATEFUL=1`, each 2025-era client gets its own session, closed after 30 minutes without a request.
- **TLS**: the server speaks plain HTTP. Put it behind a TLS-terminating reverse proxy, and list the public hostname in `GT_HTTP_ALLOWED_HOSTS`.

What an authenticated caller (or, on a tokenless loopback bind, any local one) can do: make the server fetch public URLs (the SSRF guard blocks private, loopback, link-local and ULA ranges, including on redirects), and run `gt_audit` and `gt_auto_scan` against any directory the server process can read, except system directories and most hidden paths. Run the server as an unprivileged user (the Docker image runs as `gt`) and do not mount anything into it you would not want read.

## Environment Variables

Invalid numeric or enum values throw at startup rather than falling back silently.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GT_GITHUB_TOKEN` | unset | GitHub API token (rate limit 60 to 5000 req/hr). Secret. |
| `GT_CACHE_DIR` | `~/.gt-mcp-cache` | Disk cache directory. System directories are rejected. |
| `GT_NO_WATERMARK` | unset | `1` disables the invisible install-ID watermark in responses. |
| `GT_HTTP_PORT` | unset | Enables HTTP mode on this port (1-65535). |
| `GT_HTTP_HOST` | `127.0.0.1` | HTTP bind address. |
| `GT_HTTP_ALLOWED_HOSTS` | unset | Comma-separated hostnames accepted in `Host` and `Origin` besides loopback. |
| `GT_HTTP_STATEFUL` | unset | `1` gives each 2025-era client its own session. |
| `GT_AUTH_TOKEN` | unset | Bearer token for every HTTP path. Required when `GT_HTTP_HOST` is not loopback. Secret. |
| `GT_LOG_FORMAT` | `text` | `text` or `json`. Logs go to stderr. |
| `GT_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `GT_TOKEN_LIMIT` | `8000` | Default response token budget. |
| `GT_MAX_TOKEN_LIMIT` | `20000` | Upper bound for a caller-supplied token budget. |
| `GT_CACHE_TTL_MS` | `1800000` | Cache entry lifetime. |
| `GT_SWR_STALE_TTL_MS` | `3600000` | How long past expiry a disk cache entry may still be served. |
| `GT_FETCH_TIMEOUT_MS` | `15000` | Per-request fetch timeout. |
| `GT_TOOL_TIMEOUT_MS` | `55000` | Overall timeout per tool call. |
| `GT_MAX_CONCURRENT_FETCHES` | `12` | Server-wide concurrent outbound fetches. |
| `GT_CONCURRENCY` | `8` | Parallel dependency lookups in `gt_auto_scan` (capped at 12). |
| `GT_DEEP_FETCH_MAX_PAGES` | `8` | Extra pages fetched when the first page misses the topic. |
| `GT_DEEP_FETCH_RELEVANCE_THRESHOLD` | `0.3` | First-page topic relevance (0-1) at which no extra pages are fetched. |
| `GT_DEEP_FETCH_TIMEOUT_MS` | `25000` | Time budget for those extra pages. |
| `GT_CIRCUIT_BREAKER_THRESHOLD` | `3` | Failures before a domain's circuit opens. |
| `GT_CIRCUIT_BREAKER_RESET_MS` | `60000` | How long an open circuit stays open. |

## Security Design Notes

- **Prompt injection guard**: fetched content is scanned against `INJECTION_PATTERNS` in `src/constants.ts`, with zero-width and bidi characters stripped and homoglyph variants normalized first. This is best-effort pattern redaction, not a guarantee. Treat fetched documentation as untrusted input.
- **Input validation**: all tool inputs are validated with Zod schemas before processing.
- **Outbound requests**: GroundTruth fetches public documentation URLs, some of them through the Jina Reader service (`r.jina.ai`), which therefore sees the URLs being fetched. It also checks the npm registry for a newer release. `GT_GITHUB_TOKEN` is attached only to requests aimed at GitHub hosts and is never logged.
- **No persistence of user data**: the disk cache stores fetched documentation content under SHA-256-hashed keys. No prompts, tool inputs or model responses are written to disk.
- **Obfuscated build**: the published npm package runs `javascript-obfuscator` over `dist` to hide implementation source. This is IP protection, not a security boundary. Do not rely on it as one.
