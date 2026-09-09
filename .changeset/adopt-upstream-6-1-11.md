---
"@hevy-mcp/hevy-client": minor
"@hevy-mcp/operations": minor
"@hevy-mcp/core": minor
"hevy-mcp": minor
"@hevy-mcp/worker": minor
---

Adopt upstream `chrisdoc/hevy-mcp@6.1.11`.

Adopted from upstream:

- Effect-based tool handlers, service layer, and lifecycle. `runNodeLifecycle`
  now returns a `NodeLifecycleHandle` and owns a process `Scope` with
  `acquireRelease` finalizers, so a partially acquired target is closed exactly
  once on startup failure.
- Typed startup errors (`NodeCliArgumentError`, `InvalidHevyApiKeyError`) with a
  clean fatal-error path, replacing opaque `Fatal error in main()` output. The
  fork's own `--issuer-url` and `http+oauth` argument validation now uses them
  too.
- Streamable HTTP idle eviction and initialization admission reimplemented on
  Effect fibers and a `Semaphore`.
- `check-package-changesets.mjs` refactored into a pure, testable
  `packageChangesetCoverage()` function. This also removes a violation of the
  repository's own "Git safety in tests" rule: the previous test spun up real
  Git repositories and set `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME`.
- Toolchain migration from npm 12 to pnpm 12 and from `hk` to `lefthook`.
  Upstream moved every internal `@hevy-mcp/*` dependency specifier to
  `workspace:*`, which npm rejects outright with `EUNSUPPORTEDPROTOCOL`, so this
  is required rather than cosmetic.

Fixed in this fork:

- `normalizeRoutineResponse` in `@hevy-mcp/operations` cast Hevy's
  `{ routine: [Routine] }` mutation response straight to `Routine` without
  unwrapping it. `isEmptyResponse` only screens `{}`, so the wrapper passed
  through and every consumer of `routines.create` / `routines.update` received
  the wrapper instead of the routine. `create-routine` and `update-routine` now
  route through the operations layer with the unwrap applied, and both the
  wrapped-array and singular-wrapper shapes have regression coverage.
- Upstream's `[VAL-OPS-017]` test asserted `rep_range: null` on a create-mode
  set. The Hevy API rejects an explicit `rep_range: null`, which breaks every
  reps-only and warmup set, so this fork omits the key entirely. The assertion
  was corrected to match the fork's behaviour.

Kept out of this fork, per its no-telemetry policy:

- `@sentry/*` and `@opentelemetry/*` dependencies, the hard-coded Sentry DSN and
  `otel.chrisdoc.dev` OTLP collector endpoint, and the npm registry update check
  (`semver`, `registry.npmjs.org`).
- `packages/node/src/utils/startup-errors.ts` arrives from upstream as a new
  file with no merge conflict and imports `flushTelemetry`, re-wiring telemetry
  into the Node startup path. The file is kept for its typed error classes; the
  import is dropped and `flush` defaults to an inert no-op.
- `entire`, upstream's session-recording tool wired into five `lefthook` hooks,
  which uploads developer prompts and transcripts off-machine. Removed from
  `mise.toml`, `mise.lock`, and `lefthook.yml`, along with `.entire/`,
  `.pi/extensions/entire/`, `.agents/skills/using-entire/` and
  `.lefthook/pre-push/entire.sh`.
