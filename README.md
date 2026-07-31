# Plugin Federation Actions

Apache-2.0 GitHub Actions for MCP developers and Plugin Federation customers.

```yaml
uses: plugin-federation/actions/mcp-tools-list-validate@main
uses: plugin-federation/actions/nexus-oidc-exchange@main
uses: plugin-federation/actions/nexus-record-tool-catalog@main
uses: plugin-federation/actions/mcp-tool-judge-pipeline@main
```

## Actions

| Action | Path | Purpose |
|---|---|---|
| MCP `tools/list` validate | [`mcp-tools-list-validate/`](./mcp-tools-list-validate/) | Structural validate |
| Nexus OIDC exchange | [`nexus-oidc-exchange/`](./nexus-oidc-exchange/) | GHA OIDC → Nexus JWT |
| Nexus record tool catalog | [`nexus-record-tool-catalog/`](./nexus-record-tool-catalog/) | POST tools/list catalog |
| MCP tool fingerprint | [`mcp-tool-fingerprint/`](./mcp-tool-fingerprint/) | Fingerprints for analysis cache |
| Nexus list tool judges | [`nexus-list-tool-judges/`](./nexus-list-tool-judges/) | Fetch judge prompts from Nexus |
| Nexus tool analysis lookup | [`nexus-tool-analysis-lookup/`](./nexus-tool-analysis-lookup/) | Pending vs analyzed tools |
| MCP tool LLM judge | [`mcp-tool-judge/`](./mcp-tool-judge/) | Run model on pending tools |
| Nexus record tool analyses | [`nexus-record-tool-analyses/`](./nexus-record-tool-analyses/) | POST analysis results |
| MCP tool judge pipeline | [`mcp-tool-judge-pipeline/`](./mcp-tool-judge-pipeline/) | End-to-end multi-judge CI |

### LLM-as-judge (CI execution, Nexus definitions)

1. **Tenant admin** creates judges on Nexus (`systemPrompt`, `version`, etc.).
2. **CI** loads judges + fingerprints, asks Nexus what is pending, runs the
   model with **CI secrets**, records results.
3. MCP repos **do not** copy system prompts.

```yaml
permissions:
  id-token: write
  contents: read
steps:
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
    env:
      XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
```

## Development

Maintainer CI uses Node 24 for `mcp-tools-list-validate`. Composite Actions need no build.

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
