import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { z } from "zod";
import { createHevyMcpServer } from "@hevy-mcp/core";
import { createHevyClient, isHevyHttpError } from "@hevy-mcp/hevy-client";
import { assertApiKey, parseConfig } from "./utils/config.js";
import { parseNodeCliOptions, type NodeTransport } from "./utils/arguments.js";
import {
	startStreamableHttpServer,
	type HttpServerExtensions,
} from "./utils/streamable-http.js";
import { createOAuthHttpExtensions } from "./utils/oauth-http.js";
import { SqliteOAuthProvider } from "./utils/oauth-provider.js";
import { installGracefulShutdown } from "./utils/graceful-shutdown.js";
import { createNodeHevyClientOptions } from "./utils/hevy-client-debug.js";
import { createHardenedStdioTransport } from "./utils/stdio-parsing.js";
import {
	recordMcpSessionTermination,
	resolveSessionTerminationCategory,
} from "./utils/mcp-session-observability.js";
import { serviceName, serviceVersion } from "./utils/service-info.js";
import { scheduleUpdateCheck } from "./utils/version-check.js";

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

const INVALID_API_KEY_MESSAGE =
	"HEVY_API_KEY is invalid or expired. Please check your API key in the Hevy app under Settings > API Key.";
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

function getHttpStatus(error: unknown): number | undefined {
	if (isHevyHttpError(error)) {
		return error.status;
	}
	if (!error || typeof error !== "object" || !("response" in error)) {
		return undefined;
	}

	const response = error.response;
	if (!response || typeof response !== "object" || !("status" in response)) {
		return undefined;
	}

	return typeof response.status === "number" &&
		Number.isInteger(response.status) &&
		response.status >= 100 &&
		response.status <= 599
		? response.status
		: undefined;
}

function getSafeValidationDiagnostic(error: unknown): string | undefined {
	const status = getHttpStatus(error);
	if (status !== undefined) {
		return `HTTP ${status}`;
	}

	if (!error || typeof error !== "object" || !("code" in error)) {
		return undefined;
	}

	const code = error.code;
	return typeof code === "string" && SAFE_NETWORK_ERROR_CODES.has(code)
		? code
		: undefined;
}
async function validateApiKey(apiKey: string) {
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
		await startupProbeClient.getUserInfo();
	} catch (error) {
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

function buildServer(apiKey: string, _transport: NodeTransport = "stdio") {
	const server = createHevyMcpServer({
		createClient: ({ onLog }) =>
			createHevyClient({
				apiKey,
				...createNodeHevyClientOptions(),
				onLog,
			}),
	});
	console.error("Hevy client initialized with API key");
	return server;
}

export async function createNodeMcpServer(
	{ apiKey }: { apiKey: string },
	transport: NodeTransport = "stdio",
) {
	const { apiKey: validatedApiKey } = serverConfigSchema.parse({ apiKey });
	await validateApiKey(validatedApiKey);
	return buildServer(validatedApiKey, transport);
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

	let connectAttempted = false;
	try {
		const cfg = parseConfig(process.env);
		const apiKey = cfg.apiKey;
		assertApiKey(apiKey);

		const server = await createNodeMcpServer({ apiKey });
		console.error("Starting MCP server in stdio mode");
		const transport = createHardenedStdioTransport(new StdioServerTransport());
		connectAttempted = true;

		await server.connect(transport);

		scheduleUpdateCheck({
			packageName: serviceName,
			currentVersion: serviceVersion,
		});
		installGracefulShutdown({
			target: server,
			onComplete: (succeeded) => {
				recordMcpSessionTermination(
					resolveSessionTerminationCategory(succeeded),
				);
			},
		});
	} catch (e) {
		recordMcpSessionTermination(
			connectAttempted ? "connect_failure" : "startup_failure",
		);
		throw e;
	}
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

	let listening = false;
	try {
		const cfg = parseConfig(process.env);
		assertApiKey(cfg.apiKey);
		await validateApiKey(cfg.apiKey);
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
			(params) => Promise.resolve(buildServer(params.apiKey, "http")),
			extensions,
		);
		listening = true;
		console.error(
			`Starting MCP server in HTTP mode at ${options.host}:${options.port}/mcp`,
		);
		scheduleUpdateCheck({
			packageName: serviceName,
			currentVersion: serviceVersion,
		});
		installGracefulShutdown({ target: handle });
	} catch (error) {
		recordMcpSessionTermination(listening ? "unknown" : "startup_failure");
		throw error;
	}
}
