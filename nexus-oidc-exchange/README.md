# Nexus OIDC exchange

Exchange a **GitHub Actions OIDC** ID token for a short-lived **Nexus** access
token (`POST /api/v1/auth/oidc/exchanges`, provider `github_actions`).

No long-lived Nexus secrets. Requires a tenant **OIDC trust policy** that matches
this repository’s immutable `repository_id`.

## Requirements

```yaml
permissions:
  id-token: write
  contents: read
```

Nexus must have `NEXUS_OIDC_GITHUB_AUDIENCE` set to the same value as
`oidc-audience`.

## Usage

```yaml
# Production (defaults nexus-url + oidc-audience to https://api.plugin-federation.com)
- id: nexus-auth
  uses: plugin-federation/actions/nexus-oidc-exchange@main
  with:
    tenant-id: ${{ vars.TENANT_ID }}

# Nonprod override
- id: nexus-auth
  uses: plugin-federation/actions/nexus-oidc-exchange@main
  with:
    nexus-url: ${{ vars.NEXUS_URL }}              # e.g. https://api.nonprod.plugin-federation.com
    oidc-audience: ${{ vars.NEXUS_OIDC_AUDIENCE }} # defaults to nexus-url when omitted
    tenant-id: ${{ vars.TENANT_ID }}

- uses: plugin-federation/actions/nexus-record-tool-catalog@main
  with:
    # nexus-url optional (same production default)
    tenant-id: ${{ vars.TENANT_ID }}
    source-id: ${{ vars.MCP_SOURCE_ID }}
    access-token: ${{ steps.nexus-auth.outputs.access-token }}
    tools-list-file: ci/tools-list.json
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `nexus-url` | no | Nexus origin (default: `https://api.plugin-federation.com`) |
| `tenant-id` | yes | Tenant UUID |
| `oidc-audience` | no | `getIDToken` audience (default: same as `nexus-url`) |
| `token-file` | no | Where to write the token (default: `$RUNNER_TEMP/nexus.token`) |

## Outputs

| Output | Description |
|--------|-------------|
| `access-token` | Masked Bearer token |
| `token-file` | Path to token file |
| `principal` | e.g. `service:gha:OWNER_ID/REPO_ID` |
| `matched-policy-id` | Trust policy UUID |
| `roles` | Comma-separated roles |
| `expires-at` | Expiry when present |

## License

Apache-2.0 — see repository [LICENSE](../LICENSE).
