# Anthropic MCP Eval

Reusable GitHub Action for running MCP functional evaluations in the
[Anthropic skill-creator eval format](https://github.com/anthropics/skills)
(`evaluations.xml` with `qa_pair` questions).

Migrated from the retired `plugin-federation/plugin-federation-actions` repo.
Prefer this path:

```yaml
uses: plugin-federation/actions/anthropic-mcp-eval@main
```

## Usage (stdio)

```yaml
- uses: plugin-federation/actions/anthropic-mcp-eval@main
  with:
    evals-dir: ./evals
    transport: stdio
    mcp-command: python
    mcp-args: src/server.py
    provider-model: xai/grok-build-0.1
    provider-api-key: ${{ secrets.XAI_API_KEY }}
    provider-api-base: https://api.x.ai/v1
    accuracy-threshold: "100"
```

The Action installs LiteLLM + MCP client, starts the server (or connects via
HTTP/SSE), runs each `qa_pair` with the configured model + tools, and fails if
accuracy is below `accuracy-threshold`.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `evals-dir` | yes | | Directory containing `evaluations.xml` |
| `transport` | no | `stdio` | `stdio`, `sse`, or `http` |
| `mcp-command` / `mcp-args` | stdio | | How to launch the server |
| `mcp-url` / `headers` | http/sse | | Remote MCP endpoint |
| `provider-model` | no | `anthropic/claude-3-7-sonnet-20250219` | LiteLLM model string |
| `provider-api-key` | no | | Mapped to provider env vars |
| `provider-api-base` | no | | Custom base URL (xAI, Azure, …) |
| `accuracy-threshold` | no | `100` | Minimum accuracy % |

## Providers

LiteLLM routes by model prefix:

- `anthropic/...` → `ANTHROPIC_API_KEY`
- `openai/...` → `OPENAI_API_KEY` (+ optional base)
- `xai/...` → `XAI_API_KEY` / `XAI_API_BASE`
- `azure/...` → Azure OpenAI vars
- `bedrock/...` → AWS credentials

## Artifact

Uploads `eval-report-<evals-dir-name>` (Markdown) for 30 days.
