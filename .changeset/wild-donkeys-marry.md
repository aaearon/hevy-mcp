---
"@hevy-mcp/hevy-client": minor
"@hevy-mcp/operations": minor
"@hevy-mcp/core": minor
"hevy-mcp": minor
"@hevy-mcp/worker": minor
---

Adopt upstream `chrisdoc/hevy-mcp@6.1.1`, with all runtime telemetry stripped.

Upstream changes carried in:

- New runtime-neutral `@hevy-mcp/operations` workspace holding shared Hevy
  domain operations (workout list/retrieval, routine list/retrieval), consumed
  by `@hevy-mcp/core`.
- Centralized Hevy endpoint policy, structured execution outcomes
  (`outcome`/`phase`/`operation_safety`/`commit_state`/`safe_to_retry`) and
  cancellation support in `@hevy-mcp/hevy-client` and `@hevy-mcp/core`.
- The Node package split into a side-effect-free embedding entry
  (`createNodeMcpServer` in `src/index.ts`) and a lazily imported runtime
  bootstrap (`src/runtime.ts`), plus a centralized process lifecycle.
- Bounded HTTP session admission for the local Streamable HTTP transport:
  `HEVY_MCP_HTTP_MAX_SESSIONS`, `HEVY_MCP_HTTP_MAX_INITIALIZING`,
  `HEVY_MCP_HTTP_IDLE_TIMEOUT_MS` and `HEVY_MCP_HTTP_BODY_TIMEOUT_MS`, with
  idle eviction, per-session lifecycle abort, and `408`/`429`/`503` responses.
- Worker fixes for Claude CIMD metadata and stateless-request observation.

Fork-specific deviations preserved and reapplied on the new layout:

- No `@sentry/*` or `@opentelemetry/*` dependency, import, span, metric,
  exporter or environment variable anywhere in the shipped packages, and no
  npm registry update check. `api.hevyapp.com` remains the only host the
  server contacts.
- The Worker no longer derives a pseudonymous HMAC user identity from the
  caller's Hevy API key; only the Cloudflare colo is attached to activity
  observation.
- The fork-only `http+oauth` Node transport keeps working: the OAuth
  authorization-server routes and bearer gate plug into upstream's reworked
  `startStreamableHttpServer` through the `HttpServerExtensions` hooks.
