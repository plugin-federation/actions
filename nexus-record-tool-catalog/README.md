# Nexus record tool catalog

POST an MCP `tools/list` snapshot to Nexus as an immutable tool catalog:

`POST /api/v1/tenants/{tenantId}/tool-sources/{sourceId}/catalogs`

Maps file shape `{ "tools": [ { name, description, inputSchema, ... } ] }` to
the Nexus `tool-catalog` contract (strips non-contract fields such as
`outputSchema`).

## Prerequisites

- Short-lived Nexus token with `plugin_author` (or equivalent) for the tenant —
  typically from [`nexus-oidc-exchange`](../nexus-oidc-exchange/).
- Stable `source-id` UUID for this MCP server in the tenant.

## Usage

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - id: auth
    uses: plugin-federation/actions/nexus-oidc-exchange@main
    with:
      tenant-id: ${{ vars.TENANT_ID }}
      # nexus-url / oidc-audience default to https://api.plugin-federation.com

  - id: catalog
    uses: plugin-federation/actions/nexus-record-tool-catalog@main
    with:
      tenant-id: ${{ vars.TENANT_ID }}
      source-id: ${{ vars.MCP_SOURCE_ID }}
      access-token: ${{ steps.auth.outputs.access-token }}
      tools-list-file: ci/tools-list.json
      # source-version defaults to github.sha
      # nexus-url / console-url optional (prod defaults; console derived from api. → console.)

  - run: |
      echo "digest=${{ steps.catalog.outputs.catalog-digest }}"
      echo "console=${{ steps.catalog.outputs.console-url }}"
```

The Action prints a GitHub notice and job summary link to the Console evidence page:

```text
{console}/tool-sources/{sourceId}/catalogs/{catalogDigest}?tenantId=…&sourceVersion=…
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `nexus-url` | no | Nexus origin (default: `https://api.plugin-federation.com`) |
| `console-url` | no | Console origin; default derives from `nexus-url` (`api.` → `console.`) |
| `tenant-id` | yes | Tenant UUID |
| `source-id` | yes | Tool source UUID |
| `access-token` | yes | Nexus Bearer token |
| `tools-list-file` | yes | Path to tools/list JSON |
| `source-version` | no | Default: `github.sha` |
| `idempotency-key` | no | Default: `catalog-{source-version}` |
| `request-id` | no | Default: `gha-{run_id}-{attempt}` |

## Outputs

| Output | Description |
|--------|-------------|
| `catalog-digest` | e.g. `sha256:…` |
| `source-id` | Echoed source UUID |
| `source-version` | Version recorded |
| `recorded-at` | Server timestamp |
| `http-status` | `201` / `200` |
| `console-url` | Absolute Console deep link for this catalog |

## License

Apache-2.0 — see repository [LICENSE](../LICENSE).
