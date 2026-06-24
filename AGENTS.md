# Agent Instructions for hevy-mcp

**ALWAYS follow these instructions first and only fallback to search or additional context if the information here is incomplete or found to be in error.**

## Project Overview

- **hevy-mcp** is a Model Context Protocol (MCP) server for the Hevy Fitness API, enabling AI agents to manage workouts, routines, exercise templates, and folders via the Hevy API.
- The codebase is TypeScript (Node.js v26+), with a clear separation between tool implementations (`src/tools/`), generated API clients (`src/generated/`), and utility logic (`src/utils/`).
- API client code is generated from the OpenAPI spec using [Kubb](https://kubb.dev/). **Do not manually edit generated files.**
- **Type Safety:** The project uses Zod schema inference for type-safe tool parameters, eliminating manual type assertions and ensuring compile-time type safety.

## Git & Workflow Standards

- **Conventional Commits**: AI agents (such as Claude Code, Antigravity, etc.) and developers must always use the conventional commit format (e.g., `feat:`, `fix:`, `refactor:`, `build:`, `ci:`, `chore:`, `docs:`, `style:`, `test:`) for all commits they generate or suggest.
- **GitHub Squash and Merge**: When using "Squash and Merge" on GitHub, always ensure the **PR Title** (which becomes the final commit title) follows the conventional commit format in **lowercase** (e.g., `refactor: replace biome with oxlint`). This is critical for `semantic-release` to correctly identify version bumps.

## Agent Tool Requirements

### Documentation and Research

- **Context7**: MUST use Context7 for any library and API documentation needs
- **GitHub Integration**: MUST use the GitHub MCP server for all GitHub interactions and only use `gh` if there is a problem with the personal access token
- **AI Feedback**: MUST ask Gemini for feedback (about a design, code review, etc.) but remember Gemini has no memory so everything must be provided in the prompt and you must refer to files using the @ syntax

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
   - Always run this after updating `openapi-spec.json`.

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

- **`npm run export-specs`**: Fails with network error (`ENOTFOUND api.hevyapp.com`) in sandboxed environments.
- **`npm run inspect`**: MCP inspector tool - may timeout in environments without proper MCP client setup.

Only list commands here that are known to be flaky or unsupported in some
environments. Other documented commands (including `npm run check:types`) are
expected to succeed locally; treat failures as issues to fix rather than
environmental flakiness. See `README.md` for the canonical list of commands.

`npm run check:types` is expected to pass locally before opening a PR; see the
"Type checking validation" section below.

## Environment Setup

### Required Environment Variables

Create a `.env` file in the project root with:

```env
HEVY_API_KEY=your_hevy_api_key_here
```

**CRITICAL:** Without this API key:

- Servers will not start
- Integration tests will fail (by design)
- API client functionality cannot be tested

### Node.js Version

- **Supported:** Node.js >= 26
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
   - **EXPECTED:** Warnings about `any` usage in `webhooks.ts` are acceptable (API methods not yet available).

4. **Type checking validation:**

   ```bash
   npm run check:types
   ```

   - Must complete without errors.
   - Runs the TypeScript compiler in check-only mode (no emitted files), as
     configured in the `check:types` script in `package.json`.
   - Note: `npm run build` (tsup) may still succeed when this fails.
   - Treat failures here as issues to fix (even if the build passes).
   - Run this locally before opening a PR (CI does not currently run this check).
   - Verifies all type inference is working correctly.

5. **MCP tool functionality validation (if API key available):**
   - Start development server: `npm run dev`
   - Test MCP tool endpoints with a client
   - Verify tool responses are correctly formatted

### Critical Validation Notes

- **ALWAYS** run unit tests after any source code changes
- **ALWAYS** run build validation before committing changes
- **ALWAYS** use type inference (`InferToolParams`) instead of manual type assertions
- **DO NOT** attempt to fix TypeScript errors in `src/generated/` - these are auto-generated files
- **DO NOT** commit `.env` files containing real API keys
- **DO NOT** use `as any` or `as unknown` type assertions in tool handlers

## Project Structure and Key Files

### Source Code Organization

```
src/
├── index.ts           # Main entry point - register tools here
├── tools/             # MCP tool implementations
│   ├── workouts.ts    # Workout management tools
│   ├── routines.ts    # Routine management tools
│   ├── templates.ts   # Exercise template tools
│   ├── folders.ts     # Routine folder tools
│   └── webhooks.ts    # Webhook subscription tools
├── generated/         # Auto-generated API client (DO NOT EDIT)
│   ├── client/        # Kubb-generated client code
│   └── schemas/       # Zod validation schemas
└── utils/             # Shared helper functions
    ├── tool-helpers.ts    # Type inference utilities (InferToolParams)
    ├── error-handler.ts   # Centralized error handling (withErrorHandling)
    ├── response-formatter.ts # MCP response utilities
    ├── formatters.ts      # Data formatting helpers
    ├── hevyClient.ts      # API client factory
    ├── hevyClientKubb.ts  # Kubb client wrapper
    ├── config.ts          # Configuration parsing
    └── httpServer.ts      # HTTP server utilities (deprecated)
```

### Testing Structure

```
tests/
├── integration/       # Integration tests (require API key)
└── unit tests are co-located with source files (*.test.ts)
```

### Client Architecture

The project uses a generated API client via Kubb that creates:

- TypeScript types in `src/generated/client/types/`
- API methods in `src/generated/client/api/`
- Zod schemas in `src/generated/client/schemas/`
- Mock data in `src/generated/client/mocks/`

### Configuration Files

- `kubb.config.ts` - API client generation configuration
- `oxlint and oxfmt configuration` - Code formatting and linting rules (tabs, 80 char lines, double quotes)
- `lefthook.yml` - Git hooks for pre-commit formatting and commit message linting

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

// 3. Register with inputSchema + outputSchema, return structuredContent
server.registerTool(
	"get-routines",
	{
		description: "Description...",
		inputSchema: getRoutinesSchema,
		// outputSchema is a ZodRawShape. The MCP SDK validates the tool's
		// structuredContent against it at runtime, so the shape MUST match what
		// createJsonResponse returns (same wrapper key). Reuse the formatted Zod
		// schemas exported from formatters.ts.
		outputSchema: { routines: z.array(formattedRoutineSchema) },
		annotations: readOnlyAnnotations("Get Routines"),
	},
	withErrorHandling(async (args: GetRoutinesParams) => {
		// args is fully typed - no manual assertions needed!
		const { page, pageSize } = args;
		// ...
		// Wrap the payload in a named key so structuredContent is a JSON object.
		return createJsonResponse({ routines });
	}, "get-routines"),
);
```

#### Pattern: outputSchema and structuredContent

Tools that return JSON declare an `outputSchema` and return their payload wrapped
in a named key via `createJsonResponse`, which emits both the text `content` and a
machine-readable `structuredContent` object. Rules:

- **Wrap payloads in a named key**: `{ workouts: [...] }`, `{ workout: {...} }`.
  `structuredContent` must be a JSON object, never a bare array.
- **outputSchema key must equal the createJsonResponse key.** The SDK strictly
  validates `structuredContent` against `outputSchema` and rejects mismatches.
- **Use schema-derived types.** `formatters.ts` defines the Zod schemas as the
  source of truth and derives the `FormattedX` types via `z.infer`, so any drift
  fails at compile time. Reuse those schemas in `outputSchema`.
- **Empty lists** return the wrapped empty array (`{ workouts: [] }`), not an
  empty/text response.
- **Not-found / failure** paths `throw new Error(...)`; `withErrorHandling` turns
  them into `isError` responses, which the SDK does not output-validate.
- **Plain-text tools** (those returning `createTextResponse`) must NOT declare an
  `outputSchema` (text responses carry no `structuredContent`).
- `src/tools/output-schema-validation.test.ts` guards every tool's
  `structuredContent` against its declared `outputSchema`.

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

1. **Create new tool file** in `src/tools/`
2. **Define Zod schema** with `as const` assertion
3. **Infer parameter types** using `InferToolParams<typeof schema>`
4. **Implement handler** with typed parameters (no manual assertions)
5. **Wrap with error handling** using `withErrorHandling` from `src/utils/error-handler.ts`
6. **Format outputs** using helpers in `src/utils/formatters.ts`
7. **Register tools** in `src/index.ts`
8. **Add unit tests** co-located with implementation

### Working with Generated Code

- **NEVER** edit files in `src/generated/` directly
- Regenerate API client: `npm run build:client`
- If OpenAPI spec changes, update `openapi-spec.json` first
- Generated types are available in `src/generated/client/types/index.ts`

### Error Handling

- Use centralized error handling from `src/utils/error-handler.ts`
- Wrap handlers with `withErrorHandling(fn, "context-name")`
- Follow existing error response patterns in tool implementations
- Error responses automatically include `isError: true` flag

## Troubleshooting

### Common Issues

1. **Server won't start:** Check for `HEVY_API_KEY` in `.env` file
2. **Integration tests failing:** Expected without valid API key
3. **TypeScript errors in generated code:** Expected - ignore these
4. **Build failures:** Run `npm run check` to identify formatting/linting issues
5. **Network errors in export-specs:** Expected in sandboxed environments
6. **Type errors in tool handlers:** Use `InferToolParams<typeof schema>` instead of manual type assertions
7. **Linter warnings about `any`:** Expected in `webhooks.ts` where API methods don't exist yet (see TODOs)

### Performance Expectations

- **Build time:** 3-5 seconds
- **Unit test time:** 1-2 seconds
- **Dependency installation:** 30 seconds
- **API client generation:** 4-5 seconds
- **Type checking:** < 1 second

## Key Utilities Reference

### Type Inference (`src/utils/tool-helpers.ts`)

- **`InferToolParams<T>`**: Infers TypeScript types from Zod schema objects
- **`createTypedToolHandler`**: Optional wrapper for automatic validation (MCP SDK already validates)

### Error Handling (`src/utils/error-handler.ts`)

- **`withErrorHandling<TParams>(fn, context)`**: Wraps handlers with error handling while preserving parameter types
- **`createErrorResponse(error, context?)`**: Creates standardized error responses

### Response Formatting (`src/utils/response-formatter.ts`)

- **`createJsonResponse(data, options?)`**: Creates JSON-formatted MCP responses. Also attaches `data` as `structuredContent` when `data` is a plain object (not an array/primitive), satisfying output-schema validation.
- **`createTextResponse(text)`**: Creates text-formatted MCP responses
- **`createEmptyResponse(message)`**: Creates empty responses with messages

## HTTP+OAuth Transport (fork-specific)

The `http+oauth` transport exposes a password-gated OAuth 2.1 authorization server + MCP resource server, compatible with claude.ai Connectors. This is specific to this fork and is not part of upstream `chrisdoc/hevy-mcp`.

Additional environment variables (required for `http+oauth` mode):

- `MCP_ISSUER_URL` - Public base URL of this server (e.g. `https://mcp.example.com`). Also settable via `--issuer-url=URL`.
- `MCP_AUTH_PASSWORD` - Password shown in the consent form; leave empty to reject all logins.
- `OAUTH_DB_PATH` - Path to the SQLite database file (default: `./oauth.db`).

Starting the server:

```bash
MCP_ISSUER_URL=http://localhost:3000 MCP_AUTH_PASSWORD=secret HEVY_API_KEY=xxx \
  node dist/cli.mjs --transport=http+oauth --port=3000
```

Verification:

```bash
# OAuth metadata
curl http://localhost:3000/.well-known/oauth-authorization-server | jq .

# Unauthenticated request should return 401
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" -d '{}'
```

### Docker Compose

`Dockerfile.oauth` and `docker-compose.yml` provide a self-contained deployment (port 8012 → 8000 inside container). The existing `Dockerfile` stub (which deliberately errors) and `docker.test.ts` are untouched.

```bash
# Create .env with HEVY_API_KEY, MCP_AUTH_PASSWORD, MCP_ISSUER_URL
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d
```

---

**Remember:** Always reference these instructions first before searching for additional information or running exploratory commands.
