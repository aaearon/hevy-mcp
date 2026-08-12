# @hevy-mcp/hevy-client

## 0.3.0

### Minor Changes

- [`f59b508`](https://github.com/chrisdoc/hevy-mcp/commit/f59b508ac8f94e94a0e267f34b1b0a1d80403ab9) - Introduce `@hevy-mcp/hevy-client` as a standalone workspace package: a
  runtime-neutral Hevy API client built on native `fetch`, together with the Kubb
  generated types and Zod schemas. It replaces the client that previously lived in
  the flat `src/generated` tree and is safe to use from both Node.js and
  Cloudflare Workers. Only the `@hevy-mcp/hevy-client/types` and
  `@hevy-mcp/hevy-client/schemas` barrels are public API; the generated API
  functions and `.kubb` internals are private.
  
  The package is private and bundled into the published `hevy-mcp` package.

- Adopt upstream `chrisdoc/hevy-mcp@6.1.1`, with all runtime telemetry stripped.
  
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

## 0.2.1

### Patch Changes

- [#968](https://github.com/chrisdoc/hevy-mcp/pull/968) [`23afac3`](https://github.com/chrisdoc/hevy-mcp/commit/23afac3c4ab0d66b60cb193d9efc86b598b1d6da) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Use Oxfmt for generated client formatting and remove the repository's Prettier dependency.

- [#968](https://github.com/chrisdoc/hevy-mcp/pull/968) [`23afac3`](https://github.com/chrisdoc/hevy-mcp/commit/23afac3c4ab0d66b60cb193d9efc86b598b1d6da) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Capture bounded, allowlisted, redacted upstream error details in API diagnostics without adding response text to metrics.

## 0.2.0

### Minor Changes

- [#944](https://github.com/chrisdoc/hevy-mcp/pull/944) [`1ae0e10`](https://github.com/chrisdoc/hevy-mcp/commit/1ae0e1017646a1fe843a35c984537995e2521f7e) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Centralize typed Hevy endpoint identity and transient error policy across client, operations, Core, and Node observability.

### Patch Changes

- [#946](https://github.com/chrisdoc/hevy-mcp/pull/946) [`1e5aed4`](https://github.com/chrisdoc/hevy-mcp/commit/1e5aed4a84ff7515d05ec46f06b0555c6814a4b4) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Enforce type-aware async function usage with Oxlint.

## 0.1.1

### Patch Changes

- [#907](https://github.com/chrisdoc/hevy-mcp/pull/907) [`4dec481`](https://github.com/chrisdoc/hevy-mcp/commit/4dec481875cb97041ab558177f94c859fe48ee3f) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Update Kubb and related development dependencies, and refresh the generated Hevy API client.

## 0.1.0

### Minor Changes

- [#887](https://github.com/chrisdoc/hevy-mcp/pull/887) [`976f570`](https://github.com/chrisdoc/hevy-mcp/commit/976f570fe1a0258ee5442002c830385dc888ad72) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Add invocation-scoped cancellation, absolute deadlines, commit-state outcomes, and safe retry diagnostics across the Hevy client, MCP adapters, Worker, Node server, and CLI.

### Patch Changes

- [#890](https://github.com/chrisdoc/hevy-mcp/pull/890) [`5f78f33`](https://github.com/chrisdoc/hevy-mcp/commit/5f78f334c01016580fcff8af895d50997ef9ae87) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Keep generated client output complete and reproducible while centralizing
  repository topology, artifact provenance, and validation lanes.

## 0.0.3

### Patch Changes

- [#848](https://github.com/chrisdoc/hevy-mcp/pull/848) [`11d55d2`](https://github.com/chrisdoc/hevy-mcp/commit/11d55d238cfc4e874d470d798206c349fda4d9d0) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Add privacy-safe MCP session correlation and richer request lifecycle telemetry.

- [#848](https://github.com/chrisdoc/hevy-mcp/pull/848) [`11d55d2`](https://github.com/chrisdoc/hevy-mcp/commit/11d55d238cfc4e874d470d798206c349fda4d9d0) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Add bounded, privacy-safe failure events and expected outcome classification.

## 0.0.2

### Patch Changes

- [#833](https://github.com/chrisdoc/hevy-mcp/pull/833) [`39d5896`](https://github.com/chrisdoc/hevy-mcp/commit/39d589617b1a83ae36a97ce6b52aa89f022681e5) Thanks [@neontty](https://github.com/neontty)! - Fix get-routine failing for every routine: the Routine read schema typed each exercise's `rest_seconds` as a string, but the Hevy API returns an integer. Correct the OpenAPI spec (and regenerated client) to type it as an integer and align the get-routine output contract, matching the Post/Put routine request schemas. get-routines was unaffected because its compact projection omits `rest_seconds`.

## 0.0.1

### Patch Changes

- [#795](https://github.com/chrisdoc/hevy-mcp/pull/795) [`ba871dd`](https://github.com/chrisdoc/hevy-mcp/commit/ba871dda0dd14e125332be1cc534814737579480) Thanks [@chrisdoc](https://github.com/chrisdoc)! - Bound Hevy response fetching and body consumption with per-attempt timeouts.
