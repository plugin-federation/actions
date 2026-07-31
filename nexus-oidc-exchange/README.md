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
- id: nexus-auth
  uses: plugin-federation/actions/nexus-oidc-exchange@main
  with:
    nexus-url: ${{ vars.NEXUS_URL }}
    tenant-id: ${{ vars.TENANT_ID }}
    oidc-audience: ${{ vars.NEXUS_OIDC_AUDIENCE }}

- uses: plugin-federation/actions/nexus-record-tool-catalog@main
  with:
    nexus-url: ${{ vars.NEXUS_URL }}
    tenant-id: ${{ vars.TENANT_ID }}
    source-id: ${{ vars.MCP_SOURCE_ID }}
    access-token: ${{ steps.nexus-auth.outputs.access-token }}
    tools-list-file: ci/tools-list.json
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `nexus-url` | yes | Nexus origin |
| `tenant-id` | yes | Tenant UUID |
| `oidc-audience` | yes | `getIDToken` audience |
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
