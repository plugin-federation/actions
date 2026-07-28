# Plugin Federation Actions

Apache-2.0 **hermetic GitHub Actions** for MCP developers and Plugin Federation
customers.

```yaml
uses: plugin-federation/actions/mcp-tools-list-validate@v1
```

**Consumer jobs never run `npm install` / `npm ci` for these Actions.** Each
Action ships a pre-bundled `dist/` entrypoint executed by the Actions Node
runtime (`runs.using: node20`). No `setup-node` step is required in the
caller's workflow.

## Actions

| Action | Path | Status |
|---|---|---|
| MCP `tools/list` validate | [`mcp-tools-list-validate/`](./mcp-tools-list-validate/) | Mode A (hermetic) |

### `mcp-tools-list-validate`

Deterministic validation of an MCP tool catalog:

- **Mode A:** offline JSON file (`tools-list-file`)
- **Mode B:** live MCP Streamable HTTP `tools/list` (`mcp-config-file`) — planned

Profiles: `mcp` (protocol shape) and `plugin-federation` (composition limits).

See [mcp-tools-list-validate/README.md](./mcp-tools-list-validate/README.md).

## Repository layout

```text
mcp-tools-list-validate/   # first Action (committed dist/)
.github/workflows/         # maintainer CI only
```

## Development (maintainers)

```bash
cd mcp-tools-list-validate
npm ci
npm run build   # update dist/ and commit it
npm test
```

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
