# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.1.x   | Yes       |
| < 2.1   | No        |

## Scope

GroundTruth (`@groundtruth-mcp/gt-mcp`) is a local MCP server that fetches public documentation at query time. It does not handle user authentication, store credentials, or connect to any backend service controlled by us.

In scope for security reports:

- Prompt injection via fetched external content reaching the model
- Path traversal or arbitrary file read in the audit tool (`gt_audit`)
- Remote code execution via crafted library registry responses
- Token/secret leakage through `GT_GITHUB_TOKEN` or environment variables
- Dependency vulnerabilities with a realistic exploit path

Out of scope:

- Rate limiting or abuse of third-party documentation sources (report to them directly)
- Issues in the model or MCP client you connect GroundTruth to
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

## Security Design Notes

- **Prompt injection guard** — all content fetched from external URLs is scanned against `INJECTION_PATTERNS` in `src/constants.ts` before being returned to the model. Any attempt to embed LLM instructions in documentation is stripped.
- **Input validation** — all tool inputs are validated with Zod schemas before processing.
- **No outbound secrets** — GroundTruth only fetches public URLs. `GT_GITHUB_TOKEN` is used solely for GitHub API authentication and is never logged or forwarded.
- **No persistence of user data** — the disk cache stores only fetched documentation content keyed by URL. No prompts, no tool inputs, no model responses are ever written to disk.
- **Obfuscated build** — the published npm package uses `javascript-obfuscator` to protect the private library registry. This is IP protection, not a security boundary — do not rely on it as one.
