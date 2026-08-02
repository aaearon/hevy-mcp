---
"hevy-mcp": minor
---

Add the fork-specific `--transport http+oauth` mode: a password-gated OAuth 2.1
authorization server plus MCP resource server, so a self-hosted Node deployment
can be added to Claude as a remote Connector.

- Dynamic client registration (RFC 7591), authorization code flow with
  mandatory PKCE (S256), refresh-token rotation, revocation (RFC 7009), and
  RFC 8414 / RFC 9728 discovery documents.
- Grants persist in SQLite (`OAUTH_DB_PATH`, default `./oauth.db`) so a restart
  does not force clients to re-authorize.
- New settings: `MCP_ISSUER_URL` / `--issuer-url` (required) and
  `MCP_AUTH_PASSWORD`, which fails closed when unset or empty.
- Reuses the existing Streamable HTTP server and its MCP session lifecycle via
  new optional `HttpServerExtensions` hooks; `--transport stdio` and
  `--transport http` behavior is unchanged.
