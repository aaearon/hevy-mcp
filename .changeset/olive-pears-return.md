---
"@hevy-mcp/worker": minor
---

Introduce `@hevy-mcp/worker` as a standalone workspace package holding the
Cloudflare Worker HTTP and OAuth entrypoints, which previously had no home in
this repository. The Worker is built on `@hevy-mcp/core` and
`@hevy-mcp/hevy-client` and carries no runtime telemetry: it does not read
`CLOUDFLARE_OTEL_TRACES_DESTINATIONS` or `CLOUDFLARE_OTEL_LOGS_DESTINATIONS`.

The package is private and deployed with Wrangler rather than published to npm.
