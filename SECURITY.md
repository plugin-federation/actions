# Security Policy

## Supported versions

Only the latest tagged major line (for example `@v1`) of each composite Action
is supported for security fixes. Pin full release tags or commit SHAs for
high-assurance pipelines.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories on this
repository, or email the maintainers listed in organization settings.

Do **not** open public issues for vulnerabilities that could leak secrets or
enable SSRF against customer runners.

## Action-specific guidance

### `mcp-tools-list-validate`

- **Mode A** performs no network I/O.
- **Mode B** connects to a caller-configured MCP URL using secrets from the
  runner environment. Prefer `allowed-hosts`, HTTPS, and short-lived tokens.
  Never log Authorization headers, tokens, or raw MCP response bodies.
- Treat tools/list catalogs as sensitive metadata; avoid printing full catalogs
  in CI logs.
