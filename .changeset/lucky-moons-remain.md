---
"hevy-mcp": major
---

Remove all runtime telemetry from the shipped server.

The Node package no longer initializes Sentry or OpenTelemetry, no longer
bundles any `@sentry/*` or `@opentelemetry/*` dependency, and makes no
telemetry network requests. The pseudonymous HMAC-derived user identifier
is gone, and `createErrorResponse` no longer writes a structured
`mcp.tool.failure` event to stderr.

**Breaking changes**

- The `HEVY_MCP_TELEMETRY`, `SENTRY_DSN`, `SENTRY_RELEASE`, and
  `OTEL_COLLECTOR_TOKEN` environment variables are no longer read and have
  no effect. Telemetry is now permanently off, so `HEVY_MCP_TELEMETRY=0`
  is unnecessary rather than broken.
- The Cloudflare Worker config no longer reads
  `CLOUDFLARE_OTEL_TRACES_DESTINATIONS` or
  `CLOUDFLARE_OTEL_LOGS_DESTINATIONS`.

Observer seams in `@hevy-mcp/core` and `@hevy-mcp/hevy-client`
(`ToolObserver`, cache observers, `tool-taxonomy`, result-telemetry
helpers) are intentionally retained; the server is simply constructed
without an observer. Local `HEVY_MCP_DEBUG=1` diagnostics and stdin
parse-hardening behavior are unchanged.
