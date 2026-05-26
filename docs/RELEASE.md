# Release procedure

Two paths: **classic token** (faster setup) or **OIDC trusted publishing** (no token rotation, recommended).

## Path A — classic NPM_TOKEN (~5 min setup)

### One-time setup

1. Generate granular access token at https://www.npmjs.com/settings/<user>/tokens
   - Permissions: `Read and write`
   - Packages: `@groundtruth-mcp/gt-mcp` (or scope `@groundtruth-mcp`)
   - **Toggle: `Allow this token to bypass two-factor authentication`** — required
   - Expiration: 90 days
2. Add to GitHub repo: `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `NPM_TOKEN`
   - Value: paste token
3. (Optional) Create environment `npm-publish` for approval gate, uncomment `environment:` line in workflow.

### Release flow

```bash
npm version minor   # or major / patch — auto-bumps + commits + tags + pushes
```

The workflow at `.github/workflows/publish.yml` triggers on tag push and:
1. Runs lint, typecheck, tests, npm audit
2. Publishes to npm with `--provenance` (Sigstore attestation)
3. Publishes to MCP Registry via `mcp-publisher`

Verify:
```bash
npm view @groundtruth-mcp/gt-mcp version
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=groundtruth" | jq .
```

---

## Path B — npm trusted publishing OIDC (recommended, ~10 min setup)

No tokens. GitHub mints short-lived OIDC tokens that npm verifies.

### One-time setup

1. Publish at least one version manually (already done — 6.0.0 exists).
2. At https://www.npmjs.com/package/@groundtruth-mcp/gt-mcp/access → `Trusted publishers`
3. Click `Add trusted publisher`. Fill:
   - Publisher: `GitHub Actions`
   - Organization or user: `rm-rf-prod`
   - Repository: `GroundTruth-MCP`
   - Workflow filename: `publish.yml`
   - Environment name: leave empty (or `npm-publish` if you uncomment environment line)
   - Allowed actions: select `npm publish`
4. Remove the `NPM_TOKEN` secret if Path A was previously configured (no longer needed).
5. In `.github/workflows/publish.yml` remove the `env: NODE_AUTH_TOKEN:` block under the publish step (workflow will use OIDC automatically when no token is set).

### Release flow

Same as Path A. The workflow gets an OIDC token from GitHub, exchanges it with npm, and publishes — no secret involvement.

---

## MCP Registry setup

The `publish-mcp-registry` job authenticates via GitHub OIDC for `io.github.rm-rf-prod/groundtruth` namespace. No additional configuration needed — GitHub-verified namespaces auto-authorize.

To skip the MCP Registry sync, delete the `publish-mcp-registry` job from the workflow.

---

## Manual emergency publish

If GH Actions is down:

```bash
TOKEN_FILE=$(mktemp)
echo "//registry.npmjs.org/:_authToken=npm_XXXXX" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
npm publish --access public --provenance=false --userconfig="$TOKEN_FILE"
shred -u "$TOKEN_FILE"
```

`--provenance=false` is required because Sigstore attestation needs a CI environment. Revoke the token immediately after.

---

## Verification checklist

- [ ] `npm view @groundtruth-mcp/gt-mcp version` shows new version
- [ ] npm package page shows green `provenance` badge
- [ ] Sigstore transparency log entry exists: `npm view @groundtruth-mcp/gt-mcp dist.attestations`
- [ ] MCP Registry returns server: `curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=groundtruth"`
- [ ] GitHub release created with notes from CHANGELOG section
- [ ] `npx -y @groundtruth-mcp/gt-mcp@<version> --health` returns ok
