import type { IncomingMessage, ServerResponse } from "node:http";
import {
	OAuthError,
	OAuthErrorCode,
	bearerAuthChallengeResponse,
	buildOAuthProtectedResourceMetadata,
	getOAuthProtectedResourceMetadataUrl,
	verifyBearerToken,
	type OAuthClientInformationFull,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	CONSENT_HTML_HEADERS,
	CONSENT_PATH,
	SESSION_ID_PATTERN,
	renderConsentError,
	renderConsentPage,
	verifyConsentPassword,
} from "./oauth-consent.js";
import {
	OAUTH_SCOPES,
	SqliteOAuthProvider,
	type AuthorizationRequest,
} from "./oauth-provider.js";
import type { HttpServerExtensions } from "./streamable-http.js";

/**
 * Fork-specific OAuth 2.1 authorization-server + resource-server routes for the
 * `http+oauth` transport.
 *
 * `@modelcontextprotocol/server` v2 dropped the Express `mcpAuthRouter` that
 * the pre-monorepo fork mounted, so the endpoints below are implemented here
 * directly on `node:http` and plugged into upstream's
 * {@link startStreamableHttpServer} through {@link HttpServerExtensions}. The
 * MCP session lifecycle stays entirely upstream's.
 */

export const MCP_PATH = "/mcp";
export const AUTHORIZE_PATH = "/authorize";
export const TOKEN_PATH = "/token";
export const REGISTER_PATH = "/register";
export const REVOKE_PATH = "/revoke";
export const AUTHORIZATION_SERVER_METADATA_PATH =
	"/.well-known/oauth-authorization-server";
export const PROTECTED_RESOURCE_METADATA_PATH =
	"/.well-known/oauth-protected-resource";

const MAX_OAUTH_BODY_BYTES = 64 * 1024;

/**
 * Matches the `isString` helper in `streamable-http.ts`: narrow a header or
 * origin value at the I/O boundary via zod instead of a runtime `typeof`
 * check. Concretely typed (not generic) so the oxlint type-aware checker
 * narrows the post-guard type correctly.
 */
const stringSchema = z.string();
function isString(value: string | string[] | undefined): value is string {
	return stringSchema.safeParse(value).success;
}

/** Origins allowed to talk to the OAuth endpoints from a browser. */
const ALLOWED_ORIGIN_HOSTS = new Set([
	"claude.ai",
	"www.claude.ai",
	"claude.com",
	"www.claude.com",
]);

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
	if (!origin) return false;
	try {
		const url = new URL(origin);
		return url.protocol === "https:" && ALLOWED_ORIGIN_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
	const origin = request.headers.origin;
	if (!isString(origin) || !isAllowedCorsOrigin(origin)) return;
	response.setHeader("Access-Control-Allow-Origin", origin);
	response.setHeader("Vary", "Origin");
	response.setHeader(
		"Access-Control-Allow-Headers",
		"Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
	);
	response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
	response.setHeader(
		"Access-Control-Allow-Methods",
		"GET, POST, DELETE, OPTIONS",
	);
	response.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson<T>(
	response: ServerResponse,
	status: number,
	payload: T,
): void {
	if (response.headersSent) return;
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(body).toString(),
	});
	response.end(body);
}

function sendHtml(
	response: ServerResponse,
	status: number,
	html: string,
): void {
	if (response.headersSent) return;
	response.writeHead(status, {
		...CONSENT_HTML_HEADERS,
		"Content-Length": Buffer.byteLength(html).toString(),
	});
	response.end(html);
}

function sendOAuthError<T>(response: ServerResponse, error: T): void {
	if (OAuthError.isInstance(error)) {
		const status =
			error.code === OAuthErrorCode.InvalidClient
				? 401
				: error.code === OAuthErrorCode.ServerError
					? 500
					: 400;
		sendJson(response, status, error.toResponseObject());
		return;
	}
	sendJson(response, 500, {
		error: OAuthErrorCode.ServerError,
		error_description: "Internal server error.",
	});
}

async function readRawBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let rejected = false;
		request.on("data", (chunk: Buffer | string) => {
			if (rejected) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.byteLength;
			if (size > MAX_OAUTH_BODY_BYTES) {
				rejected = true;
				request.resume();
				reject(
					new OAuthError(
						OAuthErrorCode.InvalidRequest,
						"Request body is too large.",
					),
				);
				return;
			}
			chunks.push(buffer);
		});
		request.once("error", reject);
		request.once("end", () => {
			if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
		});
	});
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
	return new URLSearchParams(await readRawBody(request));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	const raw = await readRawBody(request);
	if (raw.length === 0) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		throw new OAuthError(
			OAuthErrorCode.InvalidRequest,
			"Request body must be valid JSON.",
		);
	}
}

/** RFC 6749 §2.3.1 HTTP Basic client authentication. */
function parseBasicAuth(
	header: string | string[] | undefined,
): { clientId: string; clientSecret: string } | undefined {
	if (!isString(header)) return undefined;
	if (!header.toLowerCase().startsWith("basic ")) return undefined;
	const decoded = Buffer.from(header.slice(6).trim(), "base64").toString(
		"utf8",
	);
	const separator = decoded.indexOf(":");
	if (separator < 0) return undefined;
	return {
		clientId: decodeURIComponent(decoded.slice(0, separator)),
		clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
	};
}

function authenticateClient(
	provider: SqliteOAuthProvider,
	request: IncomingMessage,
	form: URLSearchParams,
): OAuthClientInformationFull {
	const basic = parseBasicAuth(request.headers.authorization);
	const clientId = basic?.clientId ?? form.get("client_id") ?? "";
	const clientSecret =
		basic?.clientSecret ?? form.get("client_secret") ?? undefined;
	if (!clientId) {
		throw new OAuthError(
			OAuthErrorCode.InvalidClient,
			"client_id is required.",
		);
	}
	return provider.authenticateClient(clientId, clientSecret || undefined);
}

/**
 * Validate an `/authorize` query string. PKCE with S256 is mandatory — without
 * it a leaked authorization code would be redeemable on its own.
 */
export function parseAuthorizationRequest(
	query: URLSearchParams,
	client: OAuthClientInformationFull,
): AuthorizationRequest {
	if (query.get("response_type") !== "code") {
		throw new OAuthError(
			OAuthErrorCode.UnsupportedResponseType,
			"Only response_type=code is supported.",
		);
	}
	const redirectUri = query.get("redirect_uri") ?? client.redirect_uris[0];
	if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
		throw new OAuthError(
			OAuthErrorCode.InvalidRedirectUri,
			"redirect_uri is not registered for this client.",
		);
	}
	const codeChallenge = query.get("code_challenge");
	const method = query.get("code_challenge_method");
	if (!codeChallenge || method !== "S256") {
		throw new OAuthError(
			OAuthErrorCode.InvalidRequest,
			"PKCE is required: supply code_challenge with code_challenge_method=S256.",
		);
	}
	const requested = (query.get("scope") ?? "").split(/\s+/u).filter(Boolean);
	const invalid = requested.filter(
		(scope) => !OAUTH_SCOPES.includes(scope as (typeof OAUTH_SCOPES)[number]),
	);
	if (invalid.length > 0) {
		throw new OAuthError(
			OAuthErrorCode.InvalidScope,
			`Unsupported scope: ${invalid.join(", ")}`,
		);
	}
	return {
		clientId: client.client_id,
		redirectUri,
		scopes: requested.length > 0 ? requested : [...OAUTH_SCOPES],
		state: query.get("state") ?? undefined,
		codeChallenge,
		resource: query.get("resource") ?? undefined,
	};
}

export interface OAuthHttpOptions {
	issuerUrl: string;
	provider: SqliteOAuthProvider;
	/** Defaults to `process.env.MCP_AUTH_PASSWORD`; empty/unset rejects all logins. */
	getPassword?: () => string | undefined;
}

export function createOAuthHttpExtensions(
	options: OAuthHttpOptions,
): HttpServerExtensions {
	const { provider } = options;
	const issuerUrl = options.issuerUrl.replace(/\/+$/u, "");
	const resourceServerUrl = new URL(`${issuerUrl}${MCP_PATH}`);
	const resourceMetadataUrl =
		getOAuthProtectedResourceMetadataUrl(resourceServerUrl);
	const getPassword =
		options.getPassword ?? (() => process.env.MCP_AUTH_PASSWORD);
	const dangerouslyAllowInsecureIssuerUrl =
		process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL === "1";

	// Fail fast on a misconfigured issuer, before any request arrives.
	const protectedResourceMetadata = buildOAuthProtectedResourceMetadata({
		oauthMetadata: provider.metadata(),
		resourceServerUrl,
		scopesSupported: [...OAUTH_SCOPES],
		resourceName: "Hevy MCP Server",
		dangerouslyAllowInsecureIssuerUrl,
	});

	function completeAuthorization(
		response: ServerResponse,
		request: AuthorizationRequest,
	): void {
		const code = provider.createAuthorizationCode(request);
		const redirect = new URL(request.redirectUri);
		redirect.searchParams.set("code", code);
		if (request.state) redirect.searchParams.set("state", request.state);
		response.writeHead(302, {
			Location: redirect.toString(),
			"Cache-Control": "no-store",
		});
		response.end();
	}

	async function handleAuthorize(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<void> {
		if (request.method !== "GET") {
			response.writeHead(405, { Allow: "GET" }).end();
			return;
		}
		const clientId = url.searchParams.get("client_id") ?? "";
		const client = clientId ? provider.getClient(clientId) : undefined;
		if (!client) {
			sendHtml(response, 400, renderConsentError("Unknown OAuth client."));
			return;
		}
		let authorizationRequest: AuthorizationRequest;
		try {
			authorizationRequest = parseAuthorizationRequest(
				url.searchParams,
				client,
			);
		} catch (error) {
			const description = OAuthError.isInstance(error)
				? error.message
				: "Invalid authorization request.";
			sendHtml(response, 400, renderConsentError(description));
			return;
		}
		const sessionId = provider.createPendingAuthorization(
			client,
			authorizationRequest,
		);
		sendHtml(
			response,
			200,
			renderConsentPage({
				sessionId,
				clientName: client.client_name?.trim() || client.client_id,
			}),
		);
		return Promise.resolve();
	}

	async function handleConsent(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<void> {
		if (request.method === "GET") {
			const sessionId = url.searchParams.get("session") ?? "";
			if (!SESSION_ID_PATTERN.test(sessionId)) {
				sendHtml(
					response,
					400,
					renderConsentError("Invalid or missing session parameter."),
				);
				return;
			}
			sendHtml(
				response,
				200,
				renderConsentPage({ sessionId, clientName: "This client" }),
			);
			return;
		}
		if (request.method !== "POST") {
			response.writeHead(405, { Allow: "GET, POST" }).end();
			return;
		}

		const form = await readForm(request);
		const sessionId = form.get("session") ?? "";
		const password = form.get("password") ?? "";
		if (!SESSION_ID_PATTERN.test(sessionId)) {
			sendHtml(
				response,
				400,
				renderConsentError("Invalid or missing session parameter."),
			);
			return;
		}
		if (!verifyConsentPassword(password, getPassword())) {
			// Do not consume the pending session: let the user retry.
			sendHtml(
				response,
				401,
				renderConsentPage({
					sessionId,
					clientName: "This client",
					error: "Incorrect password.",
				}),
			);
			return;
		}
		const pending = provider.popPendingAuthorization(sessionId);
		if (!pending) {
			sendHtml(
				response,
				400,
				renderConsentError("Session expired or not found."),
			);
			return;
		}
		completeAuthorization(response, pending.request);
	}

	async function handleToken(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (request.method !== "POST") {
			response.writeHead(405, { Allow: "POST" }).end();
			return;
		}
		const form = await readForm(request);
		const client = authenticateClient(provider, request, form);
		const grantType = form.get("grant_type");
		if (grantType === "authorization_code") {
			sendJson(
				response,
				200,
				provider.exchangeAuthorizationCode(
					client,
					form.get("code") ?? "",
					form.get("code_verifier") ?? undefined,
					form.get("redirect_uri") ?? undefined,
				),
			);
			return;
		}
		if (grantType === "refresh_token") {
			const scope = form.get("scope");
			sendJson(
				response,
				200,
				provider.exchangeRefreshToken(
					client,
					form.get("refresh_token") ?? "",
					scope ? scope.split(/\s+/u).filter(Boolean) : undefined,
				),
			);
			return;
		}
		throw new OAuthError(
			OAuthErrorCode.UnsupportedGrantType,
			"Only authorization_code and refresh_token grants are supported.",
		);
	}

	async function handleRegister(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (request.method !== "POST") {
			response.writeHead(405, { Allow: "POST" }).end();
			return;
		}
		const client = provider.registerClient(await readJson(request));
		sendJson(response, 201, client);
	}

	async function handleRevoke(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (request.method !== "POST") {
			response.writeHead(405, { Allow: "POST" }).end();
			return;
		}
		const form = await readForm(request);
		authenticateClient(provider, request, form);
		provider.revokeToken(form.get("token") ?? "");
		sendJson(response, 200, {});
	}

	async function route(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<boolean> {
		const url = new URL(request.url ?? "/", issuerUrl);
		const path = url.pathname;
		const isOAuthPath =
			path === AUTHORIZE_PATH ||
			path === TOKEN_PATH ||
			path === REGISTER_PATH ||
			path === REVOKE_PATH ||
			path === CONSENT_PATH ||
			path === MCP_PATH ||
			path.startsWith(AUTHORIZATION_SERVER_METADATA_PATH) ||
			path.startsWith(PROTECTED_RESOURCE_METADATA_PATH);
		if (!isOAuthPath) return false;

		applyCors(request, response);
		if (request.method === "OPTIONS") {
			response.writeHead(204).end();
			return true;
		}

		if (path.startsWith(AUTHORIZATION_SERVER_METADATA_PATH)) {
			sendJson(response, 200, provider.metadata());
			return true;
		}
		if (path.startsWith(PROTECTED_RESOURCE_METADATA_PATH)) {
			sendJson(response, 200, protectedResourceMetadata);
			return true;
		}
		if (path === MCP_PATH) return false; // handled by the MCP transport

		try {
			if (path === AUTHORIZE_PATH)
				await handleAuthorize(request, response, url);
			else if (path === CONSENT_PATH)
				await handleConsent(request, response, url);
			else if (path === TOKEN_PATH) await handleToken(request, response);
			else if (path === REGISTER_PATH) await handleRegister(request, response);
			else await handleRevoke(request, response);
		} catch (error) {
			sendOAuthError(response, error);
		}
		return true;
	}

	async function authorize(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<boolean> {
		try {
			await verifyBearerToken(request.headers.authorization, {
				verifier: provider,
				requiredScopes: [...OAUTH_SCOPES],
				resourceMetadataUrl,
			});
			return true;
		} catch (error) {
			const challenge = bearerAuthChallengeResponse(error, {
				requiredScopes: [...OAUTH_SCOPES],
				resourceMetadataUrl,
			});
			const body = await challenge.text();
			if (!response.headersSent) {
				const headers: Record<string, string> = {};
				challenge.headers.forEach((value, key) => {
					headers[key] = value;
				});
				response.writeHead(challenge.status, {
					...headers,
					"Content-Length": Buffer.byteLength(body).toString(),
				});
				response.end(body);
			}
			return false;
		}
	}

	return {
		allowedHosts: [new URL(issuerUrl).hostname.toLowerCase()],
		handleRequest: route,
		authorize,
	};
}
