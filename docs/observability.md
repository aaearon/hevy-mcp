# Observability

This fork ships no telemetry and exports nothing. There is no Sentry, no
OpenTelemetry or OTLP export, no collector, no analytics, no user pseudonym,
no geolocation tagging, and no npm registry update check. The only host the
server contacts is `api.hevyapp.com`. See the "Telemetry and network activity"
section of the [root README](../README.md).

- **Observer seams:** `packages/core` keeps its observer seams for cheap
  upstream merges, but they are inert. There is no default implementation, and
  `tool-runtime.ts` selects the plain handler when no observer is passed. Do
  not wire a default observer.
- **Node:** `HEVY_MCP_DEBUG=1` is the only sanctioned diagnostic. It writes to
  stderr on the local machine and never leaves it.
- **Worker:** logs are console output only. No Worker log or trace destination
  is configured.
- **CLI:** optional structured stderr events with `HEVY_CLI_LOG=true`; there
  is no persistent log sink or remote exporter.

Diagnostic messages are formatted by
[the safe diagnostic formatter](../packages/core/src/diagnostics/safe-log-message.ts).
`tests/unit/no-runtime-telemetry.test.ts` guards against reintroducing
telemetry; it is a tripwire, not a proof, so read upstream merge diffs by hand.
