# Agent Instructions for hevy-mcp

**ALWAYS follow these instructions first and only fallback to search or additional context if the information here is incomplete or found to be in error.**

## Project Overview

- **hevy-mcp** is a Model Context Protocol (MCP) server for the Hevy Fitness API, enabling AI agents to manage workouts, routines, exercise templates, and folders via the Hevy API.
- The codebase is TypeScript (Node.js v24+) organized as four workspaces: the
  runtime-neutral `@hevy-mcp/hevy-client` and `@hevy-mcp/core` packages, the
  Node package in `packages/node`, and the Cloudflare package in
  `packages/worker`. All implementation lives under `packages/*`; the root is
  a private workspace orchestrator and must not gain a runtime `src/` tree.
- API client code is generated from the OpenAPI spec using [Kubb](https://kubb.dev/). **Do not manually edit generated files.**
- **Type Safety:** The project uses Zod schema inference for type-safe tool parameters, eliminating manual type assertions and ensuring compile-time type safety.
- **MCP SDK internals sensitivity:** `packages/node/src/utils/stdio-parsing.ts`
  depends on MCP SDK stdio internals (private fields such as `_readBuffer`/
  `_buffer`) to skip malformed stdin lines instead of dropping the connection.
  Re-run the stdio parse hardening test suite after any MCP TypeScript SDK
  package upgrade.

## Git & Workflow Standards

- **Conventional Commits**: AI agents (such as Claude Code, Antigravity, etc.) and developers must always use the conventional commit format (e.g., `feat:`, `fix:`, `refactor:`, `build:`, `ci:`, `chore:`, `docs:`, `style:`, `test:`) for all commits they generate or suggest.
- **No Direct Pushes to `main` (CRITICAL)**: Pushing directly to the `main` branch is strictly prohibited and blocked by branch protection. All development must be done on feature branches (e.g., `feat/some-feature` or `fix/some-bug`) and submitted via a Pull Request.
- **Fresh Worktrees (CRITICAL)**: Always begin work from a new Git worktree based on and tracking the latest `origin/main`. Fetch `origin/main` first, then create a dedicated feature worktree/branch from `origin/main`; never start implementation in an existing worktree or from a stale local `main`.
- **Never bypass Git hooks**: Never use `--no-verify` for commits or pushes. Fix the underlying hook or validation failure, then rerun the hook normally.
- **Changesets (CRITICAL)**: The project uses [Changesets](https://github.com/changesets/changesets) for versioning and releases.
  - **RELEASE CADENCE**: Merge the automated `changeset-release/main` (**"Version Packages"**) Pull Request on a regular cadence (weekly is the default), not via ad-hoc frequent merges.
  - **URGENT EXCEPTION**: Security fixes and high-impact user-facing bug fixes may be released immediately outside the routine cadence.
  - **WHEN TO USE**: Every single PR/change that modifies source code or package dependencies **MUST** include a changeset file.
  - **HOW TO CREATE BUMP CHANGESETS**: Use `npx changeset` with `patch`/`minor`/`major` **only** for user-facing, runtime-visible changes.
  - **NO-OP / NO-RELEASE CHANGES**: For docs, CI config, internal tests, refactoring, and other internal-only changes, you **MUST** run `npx changeset --empty`.
  - **CI ENFORCEMENT**: Pull Requests are guarded by a CI check that runs `npm run check:changeset` (which runs `npx changeset status --since=origin/<base_branch>`). CI will fail if no changeset file is staged/committed.
  - **VALIDATION**: You can validate your changeset status locally by running `npm run check:changeset`. Make sure the changeset file is staged/committed.

## Agent Tool Requirements

### Documentation and Research

- **GitHub Integration**: MUST use the GitHub MCP server for all GitHub interactions and only use `gh` if there is a problem with the personal access token

## Working Effectively

### Bootstrap and Build Repository

Run these commands in order to set up a working development environment (npm is the package manager for this project):

1. **Install dependencies:**

   ```bash
   npm install
   ```

   - Takes approximately 30 seconds. NEVER CANCEL - set timeout to 60+ seconds.

2. **Build the project:**

   ```bash
   npm run build
   ```

   - Takes approximately 3-5 seconds. TypeScript compilation via tsdown.
   - Always build before running the server or testing changes.

3. **Run linting/formatting:**

   ```bash
   npm run check
   ```

   - Takes less than 1 second.
   - **EXPECTED WARNING:** Warnings from oxlint are expected and can be ignored.

### Testing Commands

4. **Run unit tests only:**

   ```bash
   npx vitest run --exclude tests/integration/**
   ```

   - Takes approximately 1-2 seconds. NEVER CANCEL.
   - This is the primary testing command for development.

5. **Run integration tests (requires API key):**

   ```bash
   npx vitest run tests/integration
   ```

   - **WILL FAIL** without valid `HEVY_API_KEY` in `.env` file (by design).
   - Integration tests require real API access and cannot run in sandboxed environments.

6. **Run all tests:**

   ```bash
   npm test
   ```

   - Takes approximately 1-2 seconds for unit tests only (without API key).
   - **WILL FAIL** if `HEVY_API_KEY` is missing due to integration test failure (by design).

### API Client Generation

7. **Regenerate API client from OpenAPI spec:**

   ```bash
   npm run build:client
   ```

   - Takes approximately 4-5 seconds. NEVER CANCEL.
   - **EXPECTED WARNINGS:** OpenAPI validation warnings about missing schemas are normal.
   - If you need to refresh `openapi-spec.json` from Hevy first, run `npm run openapi`.
   - `npm run openapi` fetches the upstream spec and **WILL FAIL** with `ENOTFOUND api.hevyapp.com` in sandboxed environments.
   - Always run `npm run build:client` after updating `openapi-spec.json`.

### Server Operations

9. **Development server (with hot reload):**

   ```bash
   npm run dev
   ```

   - **REQUIRES:** Valid `HEVY_API_KEY` in `.env` file or will exit immediately.
   - Server runs indefinitely until stopped.

10. **Production server:**

```bash
npm start
```

- **REQUIRES:** Valid `HEVY_API_KEY` in `.env` file or will exit immediately.
- Must run `npm run build` first.

## Commands With Known Environment Limitations

### Known Failing Commands

- **`npm run openapi`**: Fails with network error (`ENOTFOUND api.hevyapp.com`) in sandboxed environments.
- **`npm run inspect`**: MCP inspector tool - may timeout in environments without proper MCP client setup.

Only list commands here that are known to be flaky or unsupported in some
environments. Other documented commands (including `npm run check:types`) are
expected to succeed locally; treat failures as issues to fix rather than
environmental flakiness. See `CONTRIBUTING.md` for the canonical list of
commands.

`npm run check:types` is expected to pass locally before opening a PR; see the
"Type checking validation" section below.

## Environment Setup

### Required Environment Variables

Create a `.env` file in the project root with:

```env
HEVY_API_KEY=your_hevy_api_key_here
```

Always provide the API key through `HEVY_API_KEY`.

Do **not** pass API keys via CLI arguments
(`--hevy-api-key=...`, `--hevyApiKey=...`, `hevy-api-key=...`). These CLI
forms are unsupported and insecure.

**CRITICAL:** Without this API key:

- Servers will not start
- Integration tests will fail (by design)
- API client functionality cannot be tested

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

### Node.js Version

- **Supported:** Node.js >= 24
- **Recommended:** Use the exact version pinned in `.nvmrc` (CI uses this exact version)
- If you use `nvm`, run `nvm use` in the repo root to match `.nvmrc`
- Use `node --version` to verify current version

## Validation After Changes

### Manual Testing Scenarios

Always perform these validation steps after making changes:

1. **Build validation:**

   ```bash
   npm run build
   ```

   - Must complete successfully without errors.

2. **Unit test validation:**

   ```bash
   npx vitest run --exclude tests/integration/**
   ```

   - All unit tests must pass.

3. **Code style validation:**

   ```bash
   npm run check
   ```

   - Must complete without errors (warnings about oxlint and oxfmt schema are acceptable).
   - No tool-specific lint warnings are expected; treat reported code warnings
     as issues to fix.

4. **Type checking validation:**

   ```bash
   npm run check:types
   ```

   - Must complete without errors.
   - Runs the TypeScript compiler in check-only mode (no emitted files), as
     configured in the `check:types` script in `package.json`.
   - Note: `npm run build` (tsup) may still succeed when this fails.
   - Treat failures here as issues to fix (even if the build passes).
   - Run this locally before opening a PR; CI also runs this check on pull
     requests and pushes to `main`.
   - Verifies all type inference is working correctly.

5. **MCP tool functionality validation (if API key available):**
   - Start development server: `npm run dev`
   - Test MCP tool endpoints with a client
   - Verify tool responses are correctly formatted

### Critical Validation Notes

- **ALWAYS** run unit tests after any source code changes
- **ALWAYS** run build validation before committing changes
- **ALWAYS** use type inference (`InferToolParams`) instead of manual type assertions
- **DO NOT** attempt to fix TypeScript errors in
  `packages/hevy-client/src/generated/` - these are auto-generated files
- **DO NOT** commit `.env` files containing real API keys
- **DO NOT** use `as any` or `as unknown` type assertions in tool handlers

## Project Structure and Key Files

### Source Code Organization

```
packages/
├── hevy-client/       # Runtime-neutral native-fetch client and Kubb output
├── core/              # Runtime-neutral MCP construction and tool implementations
├── node/              # Public Node.js stdio package and transports
└── worker/            # Cloudflare Worker HTTP and OAuth entrypoints

src/                  # Transitional root compatibility facades and legacy tests
```

The runtime-neutral implementation lives under `packages/core/src/`:

```
packages/core/src/
├── tools/             # MCP tool implementations (+ co-located *.test.ts)
│   ├── annotations.ts       # Workout annotation tools
│   ├── body-measurements.ts # Body measurement tools
│   ├── folders.ts           # Routine folder tools
│   ├── routines.ts          # Routine management tools
│   ├── templates.ts         # Exercise template tools
│   ├── user.ts              # User profile tools
│   └── workouts.ts          # Workout management tools
└── utils/             # Shared helper functions
    ├── tool-helpers.ts    # Type inference utilities (InferToolParams)
    ├── error-handler.ts   # Centralized error handling (withErrorHandling)
    ├── response-formatter.ts # Output schemas, formatting, and MCP responses
    ├── tool-taxonomy.ts   # Safe tool observation taxonomy
    ├── cache.ts           # Per-server template/cache helpers
    └── safe-error-diagnostic.ts # Privacy-preserving diagnostics
```

`packages/core` and `packages/hevy-client` must remain safe for both Node.js and
Cloudflare Workers. Keep Node built-ins, stdio transports, process lifecycle
handling, and stdio parse hardening in `packages/node`. Keep Cloudflare
bindings and OAuth code in `packages/worker`. The dependency graph is
`hevy-client → core → node/worker`; runtime packages must never import one
another.

### Testing Structure

```
tests/
├── integration/       # Integration tests (require API key)
└── unit tests are co-located with source files (*.test.ts)
```

### Client Architecture

The project uses a generated API client via Kubb that creates:

- TypeScript types in `packages/hevy-client/src/generated/client/types/`
- API methods in `packages/hevy-client/src/generated/client/api/`
- Zod schemas in `packages/hevy-client/src/generated/client/schemas/`

Only the curated `@hevy-mcp/hevy-client/types` and
`@hevy-mcp/hevy-client/schemas` barrels are package API. Generated API
functions and `.kubb` internals are private.

### Configuration Files

- `packages/hevy-client/kubb.config.ts` - API client generation configuration
- `oxlint and oxfmt configuration` - Code formatting and linting rules (tabs, 80 char lines, double quotes)
- `hk.pkl` and `mise.toml` - Git hooks for formatting, tests, commit message
  linting, and tool installation

## Development Patterns

### Type-Safe Tool Implementation

The project uses **Zod schema inference** for type-safe tool parameters. This eliminates manual type assertions and ensures types match schemas automatically.

#### Pattern: Using Type Inference

**Always** extract Zod schemas and use `InferToolParams` for type safety:

```typescript
import type { InferToolParams } from "../utils/tool-helpers.js";
import { withErrorHandling } from "../utils/error-handler.js";

// 1. Define schema as const
const getRoutinesSchema = {
	page: z.coerce.number().int().gte(1).default(1),
	pageSize: z.coerce.number().int().gte(1).lte(10).default(5),
} as const;

// 2. Infer types from schema
type GetRoutinesParams = InferToolParams<typeof getRoutinesSchema>;

// 3. Use inferred type in handler
server.registerTool(
	"get-routines",
	{
		description: "Description...",
		inputSchema: z.object(getRoutinesSchema),
	},
	withErrorHandling(async (args: GetRoutinesParams) => {
		// args is fully typed - no manual assertions needed!
		const { page, pageSize } = args;
		// ...
	}, "get-routines"),
);
```

**Key Benefits:**

- ✅ Single source of truth (Zod schema defines both validation and types)
- ✅ No manual type assertions (`args as {...}`)
- ✅ Automatic type updates when schemas change
- ✅ Full IDE autocomplete and type checking

**DO NOT:**

- ❌ Use `args as { ... }` type assertions
- ❌ Define parameter types separately from Zod schemas
- ❌ Use `Record<string, unknown>` in handler signatures (use inferred types)

### Adding New MCP Tools

1. **Create new tool file** in `packages/core/src/tools/`
2. **Define Zod schema** with `as const` assertion
3. **Infer parameter types** using `InferToolParams<typeof schema>`
4. **Implement handler** with typed parameters (no manual assertions)
5. **Wrap with error handling** using `withErrorHandling` from
   `packages/core/src/utils/error-handler.ts`
6. **Define and render responses** in `packages/core/src/utils/response-formatter.ts`,
   co-locating Zod output schemas, raw-to-public normalization, legacy text
   projection, and MCP response assembly
7. **Register tools** in `packages/core/src/tools/register.ts`
8. **Add unit tests** co-located with implementation

### Working with Generated Code

- **NEVER** edit files in `packages/hevy-client/src/generated/` directly
- Regenerate API client: `npm run build:client`
- If OpenAPI spec changes, refresh `openapi-spec.json` with `npm run openapi` first
- Generated types are available through `@hevy-mcp/hevy-client/types`

### Error Handling

- Use centralized error handling from `packages/core/src/utils/error-handler.ts`
- Wrap handlers with `withErrorHandling(fn, "context-name")`
- Follow existing error response patterns in tool implementations
- Error responses automatically include `isError: true` flag

## Troubleshooting

### Common Issues

1. **Server won't start:** Check for `HEVY_API_KEY` in `.env` file
2. **Integration tests failing:** Expected without valid API key
3. **TypeScript errors in generated code:** Expected - ignore these
4. **Build failures:** Run `npm run check` to identify formatting/linting issues
5. **Network errors in `npm run openapi`:** Expected in sandboxed environments
6. **Type errors in tool handlers:** Use `InferToolParams<typeof schema>` instead of manual type assertions
7. **Stale webhook references in docs:** Webhook endpoints are not currently
   available in the generated client, so docs should not reference a
   `packages/core/src/tools/webhooks.ts` tool implementation.

### Performance Expectations

- **Build time:** 3-5 seconds
- **Unit test time:** 1-2 seconds
- **Dependency installation:** 30 seconds
- **API client generation:** 4-5 seconds
- **Type checking:** < 1 second

## Key Utilities Reference

### Type Inference (`packages/core/src/utils/tool-helpers.ts`)

- **`InferToolParams<T>`**: Infers TypeScript types from Zod schema objects
- **`createTypedToolHandler`**: Optional wrapper for automatic validation (MCP SDK already validates)

### Error Handling (`packages/core/src/utils/error-handler.ts`)

- **`withErrorHandling<TParams>(fn, context)`**: Wraps handlers with error handling while preserving parameter types
- **`createErrorResponse(error, context?)`**: Creates standardized error responses

### Response Formatting (`packages/core/src/utils/response-formatter.ts`)

- **`createJsonResponse(data, options?)`**: Creates JSON-formatted MCP responses
- **`createTextResponse(text)`**: Creates text-formatted MCP responses
- **`createEmptyResponse(message)`**: Creates empty responses with messages

---

**Remember:** Always reference these instructions first before searching for additional information or running exploratory commands.
