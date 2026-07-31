# Plugin Federation Actions

Apache-2.0 GitHub Actions for MCP developers and Plugin Federation customers.

```yaml
uses: plugin-federation/actions/mcp-tools-list-validate@v1
uses: plugin-federation/actions/nexus-oidc-exchange@v1
uses: plugin-federation/actions/nexus-record-tool-catalog@v1
```

## Actions

| Action | Path | Status |
|---|---|---|
| MCP `tools/list` validate | [`mcp-tools-list-validate/`](./mcp-tools-list-validate/) | Mode A + B |
| Nexus OIDC exchange | [`nexus-oidc-exchange/`](./nexus-oidc-exchange/) | Composite |
| Nexus record tool catalog | [`nexus-record-tool-catalog/`](./nexus-record-tool-catalog/) | Composite |

### `mcp-tools-list-validate`

Deterministic validation of an MCP tool catalog:

- **Mode A:** offline JSON file (`tools-list-file`)
- **Mode B:** live `tools/list` via `mcpServers` config (`mcp-config-file`) — stdio or HTTP

Profiles: `mcp` (protocol shape) and `plugin-federation` (composition limits).

See [mcp-tools-list-validate/README.md](./mcp-tools-list-validate/README.md).

### `nexus-oidc-exchange`

Exchange a GitHub Actions OIDC ID token for a short-lived Nexus access token.
Requires `permissions: id-token: write` and a tenant OIDC trust policy.

See [nexus-oidc-exchange/README.md](./nexus-oidc-exchange/README.md).

### `nexus-record-tool-catalog`

POST a tools/list snapshot to Nexus as an immutable tool catalog for a tenant
`sourceId`. Typically paired with `nexus-oidc-exchange`.

See [nexus-record-tool-catalog/README.md](./nexus-record-tool-catalog/README.md).

### Pipeline dogfood (OIDC + catalog)

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  nexus-catalog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # … export or download tools-list.json …
      - id: auth
        uses: plugin-federation/actions/nexus-oidc-exchange@main
        with:
          nexus-url: ${{ vars.NEXUS_URL }}
          tenant-id: ${{ vars.TENANT_ID }}
          oidc-audience: ${{ vars.NEXUS_OIDC_AUDIENCE }}
      - id: catalog
        uses: plugin-federation/actions/nexus-record-tool-catalog@main
        with:
          nexus-url: ${{ vars.NEXUS_URL }}
          tenant-id: ${{ vars.TENANT_ID }}
          source-id: ${{ vars.MCP_SOURCE_ID }}
          access-token: ${{ steps.auth.outputs.access-token }}
          tools-list-file: ci/tools-list.json
```

Schema verification / proposal creation will land as a follow-up
(`mcp-schema-pipeline` or a dedicated action).

## Repository layout

```text
mcp-tools-list-validate/      # JS Action (committed dist/)
nexus-oidc-exchange/          # composite (bash)
nexus-record-tool-catalog/    # composite (bash)
.github/workflows/            # maintainer CI
```

## Development (maintainers)

Maintainer CI uses Node 24. The JS Action runtime is Node 20
(`runs.using: node20`). Composite Actions need no build step.

```bash
cd mcp-tools-list-validate
npm ci
npm run build   # update dist/ and commit it
npm test
```

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
