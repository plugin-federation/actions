# MCP tool fingerprint

Computes `sha256:…` fingerprints for tools in a tools/list file.

**Material:** `name`, `description`, `inputSchema`, `outputSchema` (if present), `annotations` (if present).

Schemas are **normalized** first so FastMCP/Pydantic noise does not affect digests
or judges:

- Drop generated `title` values like `list_citiesArguments` / `get_weatherOutput`
- Unwrap single-property `{ "result": <schema> }` output envelopes
- Drop trivial property titles (`city` → `"City"`)

Use `normalize-cli.mjs` (or the same module) before catalog record so Nexus and
Console see the same cleaned shapes.

```yaml
- uses: plugin-federation/actions/mcp-tool-fingerprint@main
  with:
    tools-list-file: ci/tools-list.json
```
