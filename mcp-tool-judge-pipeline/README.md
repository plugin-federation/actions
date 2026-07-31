# MCP tool judge pipeline

Loads **judge definitions from Nexus** (system prompts), fingerprints tools,
looks up pending tools per judge, runs the **LLM in GitHub Actions** with CI
secrets, and records analyses back to Nexus.

## Prerequisites

```yaml
permissions:
  id-token: write
  contents: read
```

- Tenant has enabled tool judges (`POST /tool-judges` as admin).
- OIDC trust policy + `MCP_SOURCE_ID` / `TENANT_ID` vars.
- Provider secret in the job env, e.g. `XAI_API_KEY`, matching judges’
  `preferredProvider`.

## Usage

```yaml
- id: auth
  uses: plugin-federation/actions/nexus-oidc-exchange@main
  with:
    tenant-id: ${{ vars.TENANT_ID }}
    nexus-url: ${{ vars.NEXUS_URL }}
    oidc-audience: ${{ vars.NEXUS_OIDC_AUDIENCE }}

- uses: plugin-federation/actions/mcp-tool-judge-pipeline@main
  with:
    nexus-url: ${{ vars.NEXUS_URL }}
    tenant-id: ${{ vars.TENANT_ID }}
    source-id: ${{ vars.MCP_SOURCE_ID }}
    access-token: ${{ steps.auth.outputs.access-token }}
    tools-list-file: ci/tools-list.json
    catalog-digest: ${{ steps.catalog.outputs.catalog-digest }}
  env:
    XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
```

MCP repositories do **not** store system prompts; they only provide tools/list
and secrets for the model provider.
