---
"@hevy-mcp/hevy-client": minor
"@hevy-mcp/operations": minor
"@hevy-mcp/core": minor
"hevy-mcp": minor
"@hevy-mcp/worker": minor
---

Adopt upstream `chrisdoc/hevy-mcp@6.1.7`.

Adopted from upstream:

- zod-based runtime validation across the Node runtime, stdio parsing, and the
  Streamable HTTP transport, replacing `as unknown as` casts.
- Response-contract refactor splitting projections into `formatters.ts` and
  `output-schemas.ts`.
- `create-routine` now declares an output schema, closing a pre-existing gap.
- `HEVY_MCP_API_TIMEOUT` default raised to 60000ms.
- KV-backed Hevy API key validation cache in the Worker.
- New `tools/oxlint/anti-slop` lint ruleset.

Kept out of this fork, per its no-telemetry policy:

- `@sentry/*` and `@opentelemetry/*` dependencies, the Sentry rollup plugin, and
  the npm registry update check (`semver`).
- The `otel-cicd-action` CI job and the `CLOUDFLARE_OTEL_*` trace/log
  destinations in `cloudflare.config.ts`.
- The HMAC user pseudonym: `createNodeUserHash` / `createWorkerUserHash`, the
  `USER_HASH_*` contract constants and their `@hevy-mcp/core` re-exports, and
  the Worker observer's `userHash` option and `user.hash` span attribute.
- City and region level geolocation span tagging in the Worker; only the
  Cloudflare colo tag is retained.
