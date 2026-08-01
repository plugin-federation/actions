# MCP tool judge pipeline

End-to-end CI step for an MCP `tools/list`:

1. **Record tool catalog** in Nexus (immutable snapshot + Console deep link)
2. Load **judge definitions** from Nexus (system prompts + `passThreshold`)
3. Fingerprint tools, look up **pending** tools per judge
4. Run the **LLM in GitHub Actions** with CI secrets
5. **Record assessments** (score 0–100, derived pass/fail, report) back to Nexus

Judges return an **overallScore** from **0–100**. CI derives
`outcome=pass` when `score >= passThreshold` (default **70**), else `fail`.

## Prerequisites

```yaml
permissions:
  id-token: write
  contents: read
```

- Tenant has an MCP tool source (`MCP_SOURCE_ID`) and OIDC trust policy.
- Optional: enabled tool judges (`POST /tool-judges` or Console). Catalog still
  records when no judges are configured.
- Provider secret in the job env (e.g. `XAI_API_KEY`) matching judges’
  `preferredProvider`.

## Usage

```yaml
- id: auth
  uses: plugin-federation/actions/nexus-oidc-exchange@main
  with:
    tenant-id: ${{ vars.TENANT_ID }}
    nexus-url: ${{ vars.NEXUS_URL }}
    oidc-audience: ${{ vars.NEXUS_OIDC_AUDIENCE }}

- id: pipeline
  uses: plugin-federation/actions/mcp-tool-judge-pipeline@main
  with:
    nexus-url: ${{ vars.NEXUS_URL }}
    tenant-id: ${{ vars.TENANT_ID }}
    source-id: ${{ vars.MCP_SOURCE_ID }}
    access-token: ${{ steps.auth.outputs.access-token }}
    tools-list-file: ci/tools-list.json
    source-version: ${{ github.sha }}
  env:
    XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
```

Outputs include `catalog-digest` and `catalog-console-url` for job summaries.

### Catalog only (no LLM)

Use [`nexus-record-tool-catalog`](../nexus-record-tool-catalog) alone, or set
`record-catalog: true` with no enabled judges (pipeline exits after catalog).

### Judges only (catalog already recorded)

```yaml
- uses: plugin-federation/actions/mcp-tool-judge-pipeline@main
  with:
    record-catalog: "false"
    catalog-digest: ${{ steps.previous.outputs.catalog-digest }}
    # ... same tenant/source/token/tools-list ...
```

MCP repositories do **not** store system prompts; they only provide tools/list
and secrets for the model provider.
