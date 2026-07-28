# Plugin Federation Actions

Apache-2.0 **composite GitHub Actions** for MCP developers and Plugin Federation
customers. Pin tagged releases that include built `dist/` artifacts.

```yaml
uses: plugin-federation/actions/mcp-tools-list-validate@v1
```

> **Note:** On `main`, Action sources are present but **`dist/` is not
> committed**. Consumers must pin a **release tag** (or the SHA of a release
> commit that contains `dist/`). Pinning `@main` is unsupported.

## Actions

| Action | Path | Status |
|---|---|---|
| MCP `tools/list` validate | [`mcp-tools-list-validate/`](./mcp-tools-list-validate/) | In development (Mode A) |

### `mcp-tools-list-validate`

Deterministic validation of an MCP tool catalog:

- **Mode A:** offline JSON file (`tools-list-file`)
- **Mode B:** live MCP Streamable HTTP `tools/list` (`mcp-config-file`) — planned

Profiles: `mcp` (protocol shape) and `plugin-federation` (composition limits).

See [mcp-tools-list-validate/README.md](./mcp-tools-list-validate/README.md) and
the monorepo component doc in `plugin-federation` (`docs/components/mcp-tools-list-validate-action.md`).

## Repository layout

```text
mcp-tools-list-validate/   # first composite Action
.github/workflows/         # CI, CodeQL, dependency review
```

## Development

```bash
cd mcp-tools-list-validate
npm ci
npm run build
npm test
```

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
