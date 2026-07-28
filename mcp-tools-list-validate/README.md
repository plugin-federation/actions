# mcp-tools-list-validate

Deterministic validation of MCP **`tools/list`** catalogs for CI.

```yaml
- uses: plugin-federation/actions/mcp-tools-list-validate@v1
  with:
    tools-list-file: ./ci/tools-list.json
    profile: plugin-federation
```

## Modes

| Mode | Input | Status |
|---|---|---|
| **A (file)** | `tools-list-file` | Offline JSON catalog |
| **B (live)** | `mcp-config-file` | Industry-standard `mcpServers` JSON; Action calls `tools/list` |

Exactly one of `tools-list-file` or `mcp-config-file` must be set.

### Mode B: `mcpServers` config

Same shape as Claude Desktop / Cursor / VS Code:

```json
{
  "mcpServers": {
    "meteo-static": {
      "command": "python",
      "args": ["src/server.py"],
      "env": {
        "API_KEY": "${API_KEY}"
      }
    }
  }
}
```

Remote / Streamable HTTP:

```json
{
  "mcpServers": {
    "remote": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
```

`${VAR}` / `$VAR` placeholders are expanded from the **job environment** (e.g. GitHub `env:` / `secrets`). Missing variables fail the step (exit 2).

When multiple servers are defined, set `mcp-server` to the key name.

```yaml
- uses: plugin-federation/actions/mcp-tools-list-validate@main
  with:
    mcp-config-file: ./ci/mcp.json
    mcp-server: meteo-static
    profile: plugin-federation
  env:
    API_KEY: ${{ secrets.API_KEY }}
```

## Profiles

- `plugin-federation` (default) — MCP shape + composition limits as errors  
- `mcp` — true MCP-required shape as errors; many PF limits as warnings  

## Local development (maintainers only)

```bash
npm ci
npm run build   # writes dist/index.cjs — commit this file
npm test

# Mode A
INPUT_TOOLS_LIST_FILE=fixtures/valid-tools-list.json \
INPUT_PROFILE=plugin-federation \
INPUT_GITHUB_ANNOTATIONS=false \
node dist/index.cjs

# Mode B (stdio mock)
INPUT_MCP_CONFIG_FILE=fixtures/mcp-servers.json \
INPUT_PROFILE=plugin-federation \
INPUT_GITHUB_ANNOTATIONS=false \
node dist/index.cjs
```

CI fails if committed `dist/` is stale relative to sources.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | validation fail |
| 2 | usage / IO / connect / missing env |
| 3 | internal error |

## Docs

- [Rule reference](./docs/rules.md)
