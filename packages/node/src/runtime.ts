import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { createHevyMcpServer, mergeAbortSignals } from "@hevy-mcp/core";
import { createHevyClient, isHevyHttpError } from "@hevy-mcp/hevy-client";
import { assertApiKey, parseConfig } from "./utils/config.js";
import { parseNodeCliOptions, type NodeTransport } from "./utils/arguments.js";
import {
	startStreamableHttpServer,
	type HttpServerExtensions,
} from "./utils/streamable-http.js";
import { createOAuthHttpExtensions } from "./utils/oauth-http.js";
import { SqliteOAuthProvider } from "./utils/oauth-provider.js";
import { createNodeHevyClientOptions } from "./utils/hevy-client-debug.js";
import { createHardenedStdioTransport } from "./utils/stdio-parsing.js";
import {
	recordMcpSessionTermination,
	resolveSessionTerminationCategory,
} from "./utils/mcp-session-observability.js";
import { serviceName, serviceVersion } from "./utils/service-info.js";
import {
	INVALID_API_KEY_MESSAGE,
	runNodeLifecycle,
} from "./utils/node-lifecycle.js";

const objectSchema = z.object({}).passthrough();
const stringSchema = z.string();
const numberSchema = z.number();

function isObject<T>(value: T): value is T & object {
	return objectSchema.safeParse(value).success;
}
function isString<T>(value: T): value is T & string {
	return stringSchema.safeParse(value).success;
}
function isNumber<T>(value: T): value is T & number {
	return numberSchema.safeParse(value).success;
}
const name = serviceName;
const version = serviceVersion;

const HELP_TEXT = [
	"Usage:",
	"  hevy-mcp [options]",
	"",
	"Options:",
	"  -h, --help                 Show this help message and exit",
	"  -v, --version              Show version and exit",
	"  --transport <transport>    stdio, http or http+oauth (default: stdio)",
	"  --host <host>              HTTP bind host (default: 127.0.0.1)",
	"  --port <port>              HTTP bind port (default: 3000)",
	"  --issuer-url <url>         Public base URL (required for http+oauth)",
	"",
	"Environment:",
	"  HEVY_API_KEY=<api-key>     Hevy API key from Hevy app settings",
	"  HEVY_MCP_DEBUG=1           Enable verbose diagnostics on stderr",
	"  HEVY_MCP_HTTP_BEARER_TOKEN Protect non-loopback HTTP deployments",
	"  MCP_ISSUER_URL             Public base URL for http+oauth",
	"  MCP_AUTH_PASSWORD          Consent password for http+oauth (fails closed)",
	"  OAUTH_DB_PATH              OAuth SQLite path (default: ./oauth.db)",
	"",
	"Examples:",
	"  HEVY_API_KEY=your-key npx hevy-mcp",
	"  HEVY_API_KEY=your-key npx hevy-mcp --transport http --port 3000",
].join("\n");

function getCliAction(args: string[]): "start" | "version" | "help" {
	for (const arg of args) {
		if (arg === "--version" || arg === "-v") {
			return "version";
		}

		if (arg === "--help" || arg === "-h") {
			return "help";
		}
	}

	return "start";
}

const HEVY_API_BASEURL = "https://api.hevyapp.com";
const STARTUP_PROBE_TIMEOUT_MS = 5_000;

const API_KEY_VALIDATION_WARNING =
	"Warning: HEVY_API_KEY could not be validated during startup. Startup will continue; check your network connection and Hevy API availability.";
const SAFE_NETWORK_ERROR_CODES = new Set([
	"EAI_AGAIN",
	"ECONNABORTED",
	"ECONNREFUSED",
	"ECONNRESET",
	"ENETUNREACH",
	"ENOTFOUND",
	"ERR_NETWORK",
	"ERR_SOCKET_TIMEOUT",
	"ETIMEDOUT",
	"HEVY_RETRY_EXHAUSTED",
]);

const serverConfigSchema = z.object({
	apiKey: z
		.string()
		.min(1, "Hevy API key is required")
		.describe("Your Hevy API key (available in the Hevy app settings)."),
});
const validationErrorDetailsSchema = z.object({
	response: z.object({ status: z.number().optional() }).optional(),
	code: z.string().optional(),
});
const validationErrorSchema = z.union([
	z.instanceof(Error),
	z.string(),
	validationErrorDetailsSchema,
]);
type ValidationError = z.infer<typeof validationErrorSchema>;

function getHttpStatus(error: ValidationError): number | undefined {
	if (isHevyHttpError(error)) {
		return error.status;
	}
	if (!error || !isObject(error) || !("response" in error)) {
		return undefined;
	}

	const response = error.response;
	if (!response || !isObject(response) || !("status" in response)) {
		return undefined;
	}

	return isNumber(response.status) &&
		Number.isInteger(response.status) &&
		response.status >= 100 &&
		response.status <= 599
		? response.status
		: undefined;
}

function getSafeValidationDiagnostic(
	error: ValidationError,
): string | undefined {
	const status = getHttpStatus(error);
	if (status !== undefined) {
		return `HTTP ${status}`;
	}

	if (!error || !isObject(error) || !("code" in error)) {
		return undefined;
	}

	const code = error.code;
	return isString(code) && SAFE_NETWORK_ERROR_CODES.has(code)
		? code
		: undefined;
}
async function validateApiKey(apiKey: string, signal?: AbortSignal) {
	// Keep the startup probe separate from the normal MCP-aware client. The
	// server is not connected yet, so structured client logging is intentionally
	// omitted until the normal client is built below.
	const startupProbeClient = createHevyClient({
		apiKey,
		baseUrl: HEVY_API_BASEURL,
		maxGetRetries: 0,
		timeoutMs: STARTUP_PROBE_TIMEOUT_MS,
	});

	try {
		await startupProbeClient.getUserInfo({
			signal,
			deadline: Date.now() + STARTUP_PROBE_TIMEOUT_MS,
		});
	} catch (caughtError) {
		const parsedError = validationErrorSchema.safeParse(caughtError);
		const error: ValidationError = isHevyHttpError(caughtError)
			? caughtError
			: parsedError.success
				? parsedError.data
				: String(caughtError);
		if (signal?.aborted) throw error;
		const status = getHttpStatus(error);
		if (status === 401 || status === 403) {
			throw new Error(INVALID_API_KEY_MESSAGE);
		}

		const diagnostic = getSafeValidationDiagnostic(error);
		console.error(
			diagnostic
				? `${API_KEY_VALIDATION_WARNING} Diagnostic: ${diagnostic}.`
				: API_KEY_VALIDATION_WARNING,
		);
	}
}

/**
 * Build a connected-ready MCP server.
 *
 * This fork ships no runtime telemetry, so no tool observer, cache observer or
 * SDK error tracking is wired here. The seams still exist in the core package
 * but are deliberately left inert; see CLAUDE.md.
 *
 * Do not name the private workspace packages literally in this comment: tsdown
 * preserves JSDoc into the published bundle, and `tests/package/npm-pack-smoke.mjs`
 * scans packed artifacts for those specifiers as raw text.
 */
function buildServer(
	apiKey: string,
	_transport: NodeTransport = "stdio",
	lifecycleSignal?: AbortSignal,
) {
	const server = createHevyMcpServer({
		createClient: ({ onLog }) =>
			createHevyClient({
				apiKey,
				...createNodeHevyClientOptions(),
				onLog,
			}),
		lifecycleSignal,
	});
	console.error("Hevy client initialized with API key");
	return server;
}

export async function createNodeMcpServer(
	{ apiKey }: { apiKey: string },
	transport: NodeTransport = "stdio",
	lifecycleSignal?: AbortSignal,
) {
	const { apiKey: validatedApiKey } = serverConfigSchema.parse({ apiKey });
	await validateApiKey(validatedApiKey, lifecycleSignal);
	return buildServer(validatedApiKey, transport, lifecycleSignal);
}

export async function runStdioServer() {
	const args = process.argv.slice(2);
	const cliAction = getCliAction(args);

	if (cliAction === "version") {
		console.error(`${name} v${version}`);
		return;
	}
	if (cliAction === "help") {
		console.log(HELP_TEXT);
		return;
	}

	await runNodeLifecycle({
		transport: "stdio",
		start: async (context) => {
			const { signal } = context;
			const cfg = parseConfig(process.env);
			const apiKey = cfg.apiKey;
			assertApiKey(apiKey);
			const server = await createNodeMcpServer({ apiKey }, "stdio", signal);
			console.error("Starting MCP server in stdio mode");
			const transport = createHardenedStdioTransport(
				new StdioServerTransport(),
			);
			context.markConnectAttempted();
			await server.connect(transport);
			context.markConnectSucceeded();
			return {
				target: server,
				onShutdown: (succeeded) =>
					recordMcpSessionTermination(
						resolveSessionTerminationCategory(succeeded),
					),
			};
		},
		onFailure: (reason, outcome) => {
			if (outcome.transport === "stdio") {
				recordMcpSessionTermination(reason);
			}
		},
	});
}

export async function runServer(): Promise<void> {
	const args = process.argv.slice(2);
	const cliAction = getCliAction(args);
	if (cliAction === "version") {
		console.error(`${name} v${version}`);
		return;
	}
	if (cliAction === "help") {
		console.log(HELP_TEXT);
		return;
	}

	const options = parseNodeCliOptions(args);
	if (options.transport === "stdio") {
		await runStdioServer();
		return;
	}

	await runNodeLifecycle({
		transport: "http",
		start: async (context) => {
			const { signal } = context;
			const cfg = parseConfig(process.env);
			assertApiKey(cfg.apiKey);
			await validateApiKey(cfg.apiKey, signal);
			let extensions: HttpServerExtensions | undefined;
			if (options.transport === "http+oauth" && options.issuerUrl) {
				extensions = createOAuthHttpExtensions({
					issuerUrl: options.issuerUrl,
					provider: new SqliteOAuthProvider({
						issuerUrl: options.issuerUrl,
					}),
				});
			}
			const handle = await startStreamableHttpServer(
				options,
				cfg.apiKey,
				(params) =>
					Promise.resolve(
						buildServer(
							params.apiKey,
							"http",
							mergeAbortSignals(signal, params.lifecycleSignal),
						),
					),
				undefined,
				extensions,
			);
			context.markListening();
			console.error(
				`Starting MCP server in HTTP mode at ${options.host}:${options.port}/mcp`,
			);
			return { target: handle };
		},
		onFailure: (_reason, outcome) => {
			if (outcome.transport === "http") {
				recordMcpSessionTermination(
					outcome.listening ? "unknown" : "startup_failure",
				);
			}
		},
	});
}
