# Nexus schema verify

POST `…/schema-verifications` for a recorded tool catalog digest so Console
**Checks** and catalog evidence pages can resolve a `verificationId`.

## Why this exists

Checks aggregate tool analyses by CI `runId` and **join** schema verification
by `sourceId + submittedCatalogDigest`. Catalog + judge pipelines alone do not
create `schema_verifications` rows — this action does.

## Prerequisites

- Catalog already recorded (`catalog-digest` from `nexus-record-tool-catalog`
  or `mcp-tool-judge-pipeline`).
- OIDC token with `plugin_author` or `checker` (create schema verification).
- At least one **plugin draft that pins** `source-id` (or pass
  `baseline-plugin-id` explicitly). Without a pin, verification is skipped
  with a warning.

## Usage

```yaml
- uses: plugin-federation/actions/nexus-schema-verify@main
  with:
    nexus-url: ${{ vars.NEXUS_URL }}
    tenant-id: ${{ vars.TENANT_ID }}
    source-id: ${{ vars.MCP_SOURCE_ID }}
    access-token: ${{ steps.auth.outputs.access-token }}
    catalog-digest: ${{ steps.pipeline.outputs.catalog-digest }}
    # optional:
    # baseline-plugin-id: ${{ vars.PLUGIN_ID }}
    # baseline-mode: draft
    # fail-on-unapproved-changes: "false"
```

`mcp-tool-judge-pipeline` calls this by default when `schema-verify: true`
(default) after catalog record.

## Outputs

| Output | Description |
|--------|-------------|
| `verification-id` | Primary verification UUID |
| `status` | `unchanged` / `unapproved_changes` / … |
| `verification-count` | How many verifications were recorded |
| `console-url` | Catalog evidence URL with `verificationId` query |
