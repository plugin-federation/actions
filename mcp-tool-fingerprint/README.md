# MCP tool fingerprint

Computes `sha256:…` fingerprints for tools in a tools/list file.

**Material:** `name`, `description`, `inputSchema`, `outputSchema` (if present), `annotations` (if present).

```yaml
- uses: plugin-federation/actions/mcp-tool-fingerprint@main
  with:
    tools-list-file: ci/tools-list.json
```
