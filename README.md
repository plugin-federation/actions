# Plugin Federation Actions

Apache-2.0 GitHub Actions for MCP developers and Plugin Federation customers.

```yaml
uses: plugin-federation/actions/mcp-tools-list-validate@v1
```

## Actions

| Action | Path | Status |
|---|---|---|
| MCP `tools/list` validate | [`mcp-tools-list-validate/`](./mcp-tools-list-validate/) | Mode A |

### `mcp-tools-list-validate`

Deterministic validation of an MCP tool catalog:

- **Mode A:** offline JSON file (`tools-list-file`)
- **Mode B:** live `tools/list` via `mcpServers` config (`mcp-config-file`) — stdio or HTTP

Profiles: `mcp` (protocol shape) and `plugin-federation` (composition limits).

See [mcp-tools-list-validate/README.md](./mcp-tools-list-validate/README.md).

## Repository layout

```text
mcp-tools-list-validate/   # first Action (committed dist/)
.github/workflows/         # maintainer CI
```

## Development (maintainers)

Maintainer CI uses Node 24. The Action runtime is Node 20 (`runs.using: node20`).

```bash
cd mcp-tools-list-validate
npm ci
npm run build   # update dist/ and commit it
npm test
```

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
