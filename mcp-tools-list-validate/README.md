# mcp-tools-list-validate

Deterministic validation of MCP **`tools/list`** catalogs for CI.

```yaml
- uses: plugin-federation/actions/mcp-tools-list-validate@v1
  with:
    tools-list-file: ./ci/tools-list.json
    profile: plugin-federation
```

## Zero consumer dependencies

This is a **hermetic JavaScript Action** (`runs.using: node20`):

| Consumer job | What happens |
|---|---|
| `npm install` / `npm ci` | **Never** — not used by this Action |
| `actions/setup-node` | **Not required** — Actions runner provides Node 20 |
| Runtime payload | Single committed file: `dist/index.cjs` (Ajv and all libs **bundled**) |

You only need the Action pin. No lockfile, no registry access, no package install step in your workflow.

Maintainers rebuild `dist/` when source changes (`npm ci && npm run build`) and commit it. CI fails if `dist/` is stale.

## Modes

| Mode | Input | Status |
|---|---|---|
| **A (file)** | `tools-list-file` | Implemented |
| **B (live)** | `mcp-config-file` + secrets | Stub (exit 2 until implemented) |

Exactly one mode input must be set.

## Profiles

- `plugin-federation` (default) — MCP shape + composition limits as errors  
- `mcp` — true MCP-required shape as errors; many PF limits as warnings  

## Local development (maintainers only)

```bash
npm ci          # only for contributors building/testing
npm run build   # writes dist/index.cjs — commit this file
npm test

INPUT_TOOLS_LIST_FILE=fixtures/valid-tools-list.json \
INPUT_PROFILE=plugin-federation \
INPUT_GITHUB_ANNOTATIONS=false \
node dist/index.cjs
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
