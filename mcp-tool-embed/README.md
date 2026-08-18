# MCP tool embed

Reusable Action that embeds each MCP tool with an embedding model and optionally
memoizes per-tool evidence in Nexus. Similarity reports are derived by Nexus,
not by this Action.

```yaml
- uses: plugin-federation/actions/mcp-tool-embed@main
  with:
    tools-list-file: ci/tools-list.json
    embedding-model: text-embedding-3-small
    provider: openai
    # Optional Nexus cache (recommended in CI dogfood):
    nexus-url: ${{ vars.NEXUS_URL }}
    tenant-id: ${{ vars.TENANT_ID }}
    source-id: ${{ vars.MCP_SOURCE_ID }}
    access-token: ${{ steps.auth.outputs.access-token }}
    catalog-digest: ${{ steps.pipeline.outputs.catalog-digest }}
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## What is embedded?

Primary selection input:

- `name`
- `description` (empty string when absent)
- canonical `inputSchema`

Input text shape:

```text
Tool name: {name}
Description: {description}
Input schema: {canonical JSON schema}
```

Output schema and annotations remain diagnostic fields; they are included in
the Nexus-compatible fingerprint even though the primary embedding text uses
the pre-call selection surface.

## Memoization (Nexus)

When `tenant-id`, `source-id`, and `access-token` are set, the Action uses the
existing tool-analyses cache:

| Field | Value |
|---|---|
| `judgeId` | `tool-embedding` (reserved synthetic id; not a Console judge pack) |
| `judgeVersion` | embedding model id |
| `toolFingerprint` | Nexus-compatible `sha256` over name, description, inputSchema, outputSchema, and annotations |
| `outcome` | `pass` on success, `error` on failure |
| `report.facets.selection` | float vector for the declared selection facet |

- Same tool surface + same model → **skip** (cache hit)
- Name, description, or schema change → new fingerprint → **re-embed**
- Model change → new `judgeVersion` → **re-embed**

Lookup does not return vectors; cache hits rehydrate embeddings via list
analyses when building the local output file. Console always reads from Nexus.

Without Nexus credentials every tool is embedded every run (no remote cache).

## Providers

OpenAI-compatible `POST {base}/embeddings`:

| `provider` | Default base | API key env |
|---|---|---|
| `openai` (default) | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `xai` | `https://api.x.ai/v1` | `XAI_API_KEY` |
| `azure_openai` | from `AZURE_API_BASE` | `AZURE_API_KEY` |
| `other` | `PROVIDER_API_BASE` | `PROVIDER_API_KEY` |

## Outputs

| Output | Description |
|---|---|
| `output-file` | JSON with per-tool vectors and cache source |
| `new-count` / `cached-count` / `error-count` | Run stats |

## Pipeline integration

`mcp-tool-judge-pipeline` runs this Action when `embedding-model` is set, so
embeddings stay independent of LLM-as-judge pending sets. This Action posts
per-tool embedding evidence only; Nexus owns cohort validation, pair scoring,
risk calibration, clustering, and similarity reports.
