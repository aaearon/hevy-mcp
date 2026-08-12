# Agent Instructions for hevy-mcp

Read this file before changing the repository. Keep this file focused on
agent-only rules; use the linked documents and repository configuration as the
source of truth for detailed commands and changing facts.

## Start in a fresh worktree

1. Inspect the checkout before touching it:

   ```bash
   git status --short --branch
   ```

2. Fetch the current base and create a dedicated feature branch/worktree from
   it:

   ```bash
   git fetch origin main
   git worktree add -b <type>/<topic> ../hevy-mcp-<topic> origin/main
   ```

   Use a branch type such as `feat`, `fix`, `docs`, `test`, `refactor`, or
   `chore`. Preserve existing user changes; ask before proceeding if creating
   the worktree would risk them.

3. Implement and validate in the new worktree. The work is ready for review
   only when the branch is based on `origin/main`, is not `main`, and the
   original checkout remains untouched.

Never push directly to `main`. Use Conventional Commits (`feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`, or `style:`) and keep
Git hooks enabled. Fix hook failures instead of bypassing them.

## Git safety in tests

- Never write tests that invoke Git, execute `git` commands, or mutate Git
  repositories or Git configuration. Use pure logic and ordinary filesystem
  fixtures instead.
- Never create, configure, or persist test Git identities such as
  `user.name`, `user.email`, `GIT_AUTHOR_*`, or `GIT_COMMITTER_*`.

## Source-of-truth pointers

- `CONTRIBUTING.md` owns development setup, Node policy, Worker operations,
  release policy, and the required validation baseline. Read the relevant
  section before that class of change.
- `docs/test-lanes.md` owns named test lanes. Prefer the `npm run test:*`
  aliases over copying raw Vitest selectors.
- `repository/topology.json` owns workspace boundaries and release bundles.
- `package.json` owns the current command names. Inspect it instead of
  copying command details into new documentation.
- Use the GitHub MCP server for GitHub operations. Use `gh` only when the
  GitHub MCP server cannot complete the operation because of a token problem.

## Runtime and package manager

Use mise for Node.js and npm. The repository pins Node.js 24 and npm 12 in
`mise.toml`; install the pinned tools before running development commands:

```bash
mise install
```

Run Node.js and npm commands through mise so they do not fall back to system
installations. Use `mise exec -- npm ...`, `mise exec -- npx ...`, and
`mise exec -- node ...` in setup, validation, and troubleshooting commands.

Git hooks are managed by hk. After `mise install`, enable them once per clone
with:

```bash
mise exec hk -- hk install --mise
```

## Repository shape and boundaries

The root is a private workspace orchestrator and has no runtime `src/` tree.
The six workspaces are:

- `packages/hevy-client` — runtime-neutral native-fetch Hevy client, curated
  exports, and Kubb-generated API types/schemas.
- `packages/operations` — runtime-neutral reusable Hevy domain operations.
- `packages/core` — runtime-neutral MCP server construction, tools, prompts,
  resources, execution, and safe diagnostics.
- `packages/node` — public Node package `hevy-mcp`; Node lifecycle, stdio,
  local Streamable HTTP and fork-only `http+oauth` transports, and Node
  built-ins. This fork ships **no** telemetry here.
- `packages/worker` — private Cloudflare Worker Streamable HTTP and optional
  OAuth adapter.
- `packages/cli` — public Node package `@chrisdoc/hevy-cli`; the standalone
  Hevy command-line client.

The dependency direction is `hevy-client -> operations -> core`, with `core`
also depending directly on `hevy-client`; Node, Worker, and CLI are adapters
that consume the runtime-neutral packages. Adapters do not import one another.
Keep Node built-ins and Cloudflare bindings out of `hevy-client`, `operations`,
and `core`. Keep Node-only lifecycle, transport, and stdio parse hardening
in `packages/node`; keep Worker bindings and Worker OAuth in
`packages/worker`. The fork's Node-side `http+oauth` transport also lives in
`packages/node`.

## Generated client

Treat every file under `packages/hevy-client/src/generated/` as generated
output. Change the OpenAPI source or the Kubb configuration, then regenerate:

```bash
mise exec -- npm run openapi          # refreshes the upstream spec; needs network access
mise exec -- npm run build:client
mise exec -- npm run check:openapi
mise exec -- npm run check:generated
```

Review the complete generated diff. Consumers use the curated
`@hevy-mcp/hevy-client`, `@hevy-mcp/hevy-client/types`, and
`@hevy-mcp/hevy-client/schemas` exports; generated API functions and `.kubb`
internals are private. Upstream schema corrections belong in
`scripts/openapi-spec.js` so regeneration remains reproducible.

## MCP and type-safety conventions

MCP tools live in `packages/core/src/tools/`. Follow the existing tool-definition
pattern when adding or changing one:

1. Put the Zod input shape in the relevant tool file or
   `tools/input-schemas.ts`.
2. Derive handler arguments with
   `InferToolParams<typeof schema>`; keep the schema as the single source of
   truth for validation and types.
3. Define the response contract and output schema for read tools in
   `utils/response-contracts.ts`.
4. Register the definition through `tools/register.ts`, use the existing
   `ToolRuntime` error/observation path, and add a co-located test.
5. Measure token cost when tool descriptions or schemas materially change:
   `npm run measure:tokens`.

Handlers receive inferred arguments. Keep manual argument casts, `any`, and
`unknown` out of tool-handler code. Reuse the existing error policy,
`withErrorHandling` path, response contracts, and safe diagnostics rather than
creating parallel response or error formats.

## Secrets and runtime behavior

Use `HEVY_API_KEY` through `.env` or the process environment. Keep `.env` and
real keys untracked, and keep keys out of command-line arguments, URLs, logs,
fixtures, screenshots, and error messages. Deterministic unit, mocked MCP,
contract, stdio, package, and performance lanes use fake credentials and do not
need a live key. Live Hevy lanes require a valid `HEVY_API_KEY`.

The Node executable defaults to stdio and also supports local Streamable HTTP
with `--transport http`; inspect `packages/node/README.md` or `--help` before
changing transport behavior. The Worker serves stateless Streamable HTTP at
`POST /mcp`, authenticates the request bearer value, and keeps OAuth optional
behind the `OAUTH_KV` binding. Read the Worker section of `CONTRIBUTING.md`
before changing deployment, origin, authentication, or OAuth behavior.

## Changesets and release identity

Before every commit, classify the diff and run:

```bash
npm run check:changeset
```

A change under `packages/*`, a runtime-visible behavior change, a workspace
dependency change, or `cloudflare.config.ts` requires a non-empty bump
Changeset. Name the changed package and every transitive shipped consumer from
`repository/topology.json`; do not couple unrelated packages. The current
cascade is:

- `@hevy-mcp/hevy-client` -> `@hevy-mcp/hevy-client`,
  `@hevy-mcp/operations`, `@hevy-mcp/core`, `hevy-mcp`,
  `@hevy-mcp/worker`, `@chrisdoc/hevy-cli`.
- `@hevy-mcp/operations` -> `@hevy-mcp/operations`,
  `@hevy-mcp/core`, `hevy-mcp`, `@hevy-mcp/worker`,
  `@chrisdoc/hevy-cli`.
- `@hevy-mcp/core` -> `@hevy-mcp/core`, `hevy-mcp`,
  `@hevy-mcp/worker`, `@chrisdoc/hevy-cli`.
- Node-only, Worker-only, and CLI-only changes bump only their respective
  package; `cloudflare.config.ts` is a Worker change.

Core, client, operations, and Worker are private but versioned for internal
release/deployment identity. Node and CLI are public. Merge the automated
`changeset-release/main` Version Packages pull request on the routine cadence
(weekly by default); reserve off-cycle releases for security fixes and
high-impact user-facing bugs. An entirely no-release, repository-only change
may use an eligible empty Changeset via `npx changeset --empty`; docs, CI,
repository-only tests/tooling, and chores qualify only when no release trigger
is present. An empty Changeset never accompanies a release trigger. Stage the
Changeset before committing.

## Validation workflow

For source changes, run the narrow relevant lane and the unit suite. Before a
pull request, use the repository baseline from `CONTRIBUTING.md`:

```bash
mise exec -- npm run check
mise exec -- npm run check:types
mise exec -- npm run build
mise exec -- npm run test:pr
mise exec -- npm run test:performance
mise exec -- npm run check:changeset
```

Useful focused checks include:

- `npm run test:stdio` after MCP SDK, stdio, lifecycle, or Node transport
  changes. `packages/node/src/utils/stdio-parsing.ts` uses private MCP
  SDK fields (`_readBuffer`/`_buffer`) to skip malformed stdin lines instead of
  dropping the connection, so inspect compatibility after every SDK upgrade.
- `npm run test:worker`, `npm run test:worker-http`, and
  `npm run worker:dry-run` after Worker changes.
- `npm run test:pack` or `npm run test:pack:cli` after package entry point,
  binary, manifest, or published-file changes.
- `npm run check:server-manifest` after server metadata changes.
- `npm run check:boundaries` after workspace dependency or runtime-boundary
  changes.

`npm run test:unit` is the deterministic default for local source work.
`npm test` builds first and runs broad Vitest discovery; it is not a substitute
for the named PR lanes. Integration, live, nightly, and live Worker commands
are credential-gated and should be run only when the relevant safe credentials
and environment are available.

Known environment-dependent operations:

- `npm run openapi` needs network access to the upstream Hevy API and may fail
  with `ENOTFOUND api.hevyapp.com` in a sandbox.
- `npm run inspect` may time out without a correctly configured MCP client or
  browser environment.

Treat all other documented checks, including `npm run check:types`, as real
failures to investigate.

## No Telemetry, No Phone-Home (fork-specific, CRITICAL)

This fork strips all runtime telemetry from upstream `chrisdoc/hevy-mcp`
(removal commit `dad8ca6`) and additionally removed upstream's npm registry
version check. **The only host the server may ever contact is
`api.hevyapp.com`.** See the "Telemetry and network activity" section of
`README.md` for the user-facing statement, which the code must keep true.

Rules for maintainers and agents:

- **Do not reintroduce telemetry.** No `@sentry/*`, no `@opentelemetry/*`, no
  analytics, no crash reporting, no usage counters that leave the machine.
- **Do not add any new outbound host.** That includes update checks, license
  pings, feature-flag fetches, and CDN loads. If a change genuinely needs one,
  it is a product decision, not an implementation detail — raise it first.
- **`packages/core` observer seams are deliberately KEPT but inert.** There is
  no default implementation, and `tool-runtime.ts` selects the plain handler
  factory when no observer is passed. They exist purely so upstream merges stay
  cheap. Keep them inert; do not wire a default observer.
- **Every upstream merge must drop the `@sentry/*` / `@opentelemetry/*` hunks**
  and any reintroduced `scheduleUpdateCheck` / `registry.npmjs.org` code.
  Upstream keeps growing this surface: as of `hevy-mcp@6.1.1` that also means
  `packages/node/src/utils/{telemetry,metrics,failure-reporter,sdk-observability,
execution-telemetry,tool-observer,hevy-client-observability,version-check}.ts`
  and the Sentry rollup plugin in `packages/node/tsdown.config.ts`.
- `repository/topology.json` carries the workspace boundary rules that
  `scripts/check-package-boundaries.mjs` enforces. Every workspace must list
  `@sentry/` and `@opentelemetry/` as forbidden imports.
- `HEVY_MCP_DEBUG=1` is the only sanctioned diagnostic. It writes to stderr and
  must never leave the machine.

### The guard test is a tripwire, not a proof

`tests/unit/no-runtime-telemetry.test.ts` scans every `packages/*/src` tree and
every `packages/*/package.json`, and asserts that `registry.npmjs.org`,
`scheduleUpdateCheck`, and `checkForUpdate` appear nowhere. It still has real
blind spots you must not mistake for coverage:

- Its import regex `/from\s+["'](@sentry\/|@opentelemetry\/)/` **misses** bare
  side-effect imports (`import "@sentry/node"`), dynamic `import()`, `require()`,
  and `createRequire()` — and this repo already uses `createRequire()` for
  `better-sqlite3`, so that pattern is live here.
- It does **not** scan `scripts/` or `repository/`, which is deliberate: the
  package-boundary rules there name `@sentry/` and `@opentelemetry/` as
  forbidden strings, so including them would be a permanent false positive.
- It matches source text only. A telemetry SDK pulled in transitively, or a host
  assembled from string fragments at runtime, is invisible to it.

Treat a green run as "no obvious regression", and still read upstream merge
diffs by hand.

## HTTP+OAuth Transport (fork-specific)

`--transport=http+oauth` turns the Node package into a password-gated OAuth 2.1
authorization server **and** MCP resource server, so this deployment can be
registered as a claude.ai Connector behind a reverse proxy. This is specific to
this fork; upstream `chrisdoc/hevy-mcp` only has OAuth in the Cloudflare Worker.

Implementation (all in `packages/node/src/utils/`):

| File                | Responsibility                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `oauth-provider.ts` | `SqliteOAuthProvider`: dynamic client registration, PKCE auth codes, token rotation, revocation, `verifyAccessToken` |
| `oauth-consent.ts`  | Password consent page: HTML escaping, constant-time password check                                                   |
| `oauth-http.ts`     | Authorization-server routes + bearer gate, wired in as `HttpServerExtensions`                                        |

`packages/core` stays runtime-neutral: no OAuth code lives there.

**MCP SDK note (important).** `@modelcontextprotocol/server` v2 removed the v1
`mcpAuthRouter` Express router and the `OAuthServerProvider` interface. Only
`requireBearerAuth` / `verifyBearerToken` / `bearerAuthChallengeResponse`,
`buildOAuthProtectedResourceMetadata` and the `OAuthTokenVerifier` interface
survive, all of them framework-free. The authorization-server endpoints
(`/authorize`, `/token`, `/register`, `/revoke`, `/consent`) are therefore
implemented here on `node:http`, and Express is no longer a dependency. The
MCP session lifecycle is **not** duplicated: `oauth-http.ts` plugs into
`startStreamableHttpServer` in `streamable-http.ts` through the optional
`HttpServerExtensions` hooks (`allowedHosts`, `handleRequest`, `authorize`).

### Endpoints

- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata
- `GET /.well-known/oauth-protected-resource[/mcp]` — RFC 9728 metadata
- `POST /register` — RFC 7591 dynamic client registration
- `GET /authorize` — renders the consent page (PKCE S256 required)
- `POST /consent` — password check, then 302 back with the authorization code
- `POST /token` — `authorization_code` and `refresh_token` grants
- `POST /revoke` — RFC 7009, revokes the whole token family
- `ALL /mcp` — Streamable HTTP, gated by `Bearer` access tokens

### Environment variables

- `MCP_ISSUER_URL` — public base URL of this server (e.g.
  `https://mcp.example.com`). Required for `http+oauth`; also settable with
  `--issuer-url=URL`.
- `MCP_AUTH_PASSWORD` — password shown on the consent form. **Fails closed:**
  when unset or empty, every login is rejected.
- `OAUTH_DB_PATH` — SQLite database file holding clients, codes and tokens so
  grants survive restarts (default: `./oauth.db`).

### Security invariants (do not regress)

- PKCE with `code_challenge_method=S256` is mandatory on `/authorize`, and the
  verifier is re-derived and compared on `/token`.
- Authorization codes and refresh tokens are single-use; refresh rotates the
  family, and revocation drops the family.
- Passwords and client secrets are compared in constant time.
- Access and refresh tokens are never logged.
- Consent HTML is escaped (`escapeHtml`), and CORS is allowlisted to
  `claude.ai` / `claude.com` origins only.
- `startStreamableHttpServer` only waives the `HEVY_MCP_HTTP_BEARER_TOKEN`
  requirement for non-loopback binds when an `authorize` extension is present.

### Running it

```bash
MCP_ISSUER_URL=http://localhost:3000 MCP_AUTH_PASSWORD=secret HEVY_API_KEY=xxx \
  node packages/node/dist/cli.mjs --transport=http+oauth --port=3000

curl http://localhost:3000/.well-known/oauth-authorization-server | jq .
# Unauthenticated MCP requests must return 401:
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" -d '{}'
```

### Docker

`Dockerfile.oauth` + `docker-compose.yml` (port `8012` → `8000`, named volume
at `/data`, `OAUTH_DB_PATH=/data/oauth.db`) provide the deployment.
`deploy/traefik-hevy-mcp.yml` is the reverse-proxy route. Upstream's own
`Dockerfile` is untouched: it uses `npm run build:standalone`, which cannot
bundle `better-sqlite3` (a native addon), so `Dockerfile.oauth` uses the normal
build plus a production `node_modules` tree instead. For the same reason
`oauth-provider.ts` loads `better-sqlite3` lazily through `createRequire`, which
keeps it out of the standalone bundle stdio users run.

## Completion checklist

Before reporting completion, confirm that the diff is focused, tests and
checks for the changed paths passed (or their limitations are explicit),
generated output is synchronized, the release requirement is satisfied, and
`git status --short --branch` shows only intended files on the feature branch.
