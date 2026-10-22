---
"@hevy-mcp/hevy-client": minor
"@hevy-mcp/operations": minor
"@hevy-mcp/core": minor
"hevy-mcp": minor
"@hevy-mcp/worker": minor
---

Adopt upstream `chrisdoc/hevy-mcp@6.2.1`.

Adopted from upstream: the `core` package reorganisation into `diagnostics/`,
`protocol/` and `runtime/`; `@hevy-mcp/operations/schemas`; the CLI split into
per-resource commands that no longer depend on `core`; a `/health` endpoint on
the local Streamable HTTP transport; a `maxGetRetries` option on
`createNodeMcpServer`; the Worker's move to `packages/worker/cloudflare.config.ts`
and the `cf` CLI; and dependency upgrades (MCP SDK 2.3.1, Effect 4.0.5,
Zod 4.6.7).

Fork behaviour kept or fixed:

- `normalizeRoutineResponse` still unwraps Hevy's `{ routine: [Routine] }`
  mutation response. Upstream now models only the singular `{ routine }`
  envelope, and the merge silently dropped the `isEmptyResponse` import the
  fork's unwrap needs.
- `create-routine` now renders the full structured output as text (upstream
  change); the unwrapped routine sits under `routine`.
- The `repository/validation-lanes.json` stdio lane names the fork's
  `stdio-parsing.test.ts`, not upstream's `stdio-observability.test.ts`.

Kept out of this fork, per its no-telemetry policy:

- The `feedback` MCP tool's recorders, which forwarded agent-written reports to
  upstream's OTLP collector at `otel.chrisdoc.dev` (Node through OpenTelemetry,
  the Worker by direct `fetch`), and the Worker's cached-validation bypass for
  feedback calls. The core tool definition stays as an inert seam and is now
  registered only when an embedder passes its own `feedbackRecorder`, so the
  default server advertises 22 tools.
- The server icon at `hevy-mcp.dev/favicon.svg`, which every MCP client fetches
  on discovery. The fork advertises no icon and links to its own repository.
- `@sentry/*`, `@opentelemetry/*`, `@effect/opentelemetry` and `semver` Node
  dependencies; Node tracing, metrics and `HEVY_MCP_TELEMETRY` config; the
  Worker `observability` block with `CLOUDFLARE_OTEL_*` destinations; the CI
  `otel-cicd-action` job and the release step that pushes `OTEL_COLLECTOR_TOKEN`
  to the Worker; user-hash and geolocation span tags; `entire` and `1password`
  in `mise.toml`.
