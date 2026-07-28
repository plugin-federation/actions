# mcp-tools-list-validate

Deterministic validation of MCP **`tools/list`** catalogs for CI.

```yaml
- uses: plugin-federation/actions/mcp-tools-list-validate@v1
  with:
    tools-list-file: ./ci/tools-list.json
    profile: plugin-federation
```

> Pin a **release tag** that includes `dist/`. `@main` is unsupported.

## Modes

| Mode | Input | Status |
|---|---|---|
| **A (file)** | `tools-list-file` | Implemented |
| **B (live)** | `mcp-config-file` + secrets | Stub (exit 2 until implemented) |

Exactly one mode input must be set.

## Profiles

- `plugin-federation` (default) — MCP shape + composition limits as errors  
- `mcp` — true MCP-required shape as errors; many PF limits as warnings  

## Local development

```bash
npm ci
npm run build
npm test

# Mode A smoke
INPUT_TOOLS_LIST_FILE=fixtures/valid-tools-list.json \
INPUT_PROFILE=plugin-federation \
INPUT_GITHUB_ANNOTATIONS=false \
node dist/index.js
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | validation fail |
| 2 | usage / IO / Mode B not ready |
| 3 | internal error |

## Docs

- [Rule reference](./docs/rules.md)
- Monorepo component: `docs/components/mcp-tools-list-validate-action.md` in `plugin-federation/plugin-federation`
