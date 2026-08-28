import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createOAuthHttpExtensions } from "./oauth-http.js";
import { SqliteOAuthProvider, deriveS256Challenge } from "./oauth-provider.js";
import { startStreamableHttpServer } from "./streamable-http.js";

const handles: Array<{ close(): Promise<void> }> = [];
const providers: SqliteOAuthProvider[] = [];
const directories: string[] = [];

/** Matches the `isString` helper in `streamable-http.test.ts`. */
const stringSchema = z.string();
function isString(value: string | AddressInfo | null): value is string {
	return stringSchema.safeParse(value).success;
}

afterEach(async () => {
	await Promise.all(handles.splice(0).map((handle) => handle.close()));
	for (const provider of providers.splice(0)) provider.close();
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

interface HttpResult {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

function call(
	port: number,
	method: string,
	path: string,
	options: {
		body?: string;
		headers?: Record<string, string>;
	} = {},
): Promise<HttpResult> {
	return new Promise((resolve, reject) => {
		const client = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method,
				headers: {
					Accept: "application/json, text/event-stream",
					...options.headers,
				},
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
				});
				response.once("end", () =>
					resolve({
						statusCode: response.statusCode ?? 0,
						headers: response.headers,
						body,
					}),
				);
			},
		);
		client.once("error", reject);
		if (options.body !== undefined) client.write(options.body);
		client.end();
	});
}

function form(
	port: number,
	path: string,
	fields: Record<string, string>,
): Promise<HttpResult> {
	const body = new URLSearchParams(fields).toString();
	return call(port, "POST", path, {
		body,
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": Buffer.byteLength(body).toString(),
		},
	});
}

async function startServer(password: string | undefined) {
	const directory = mkdtempSync(join(tmpdir(), "hevy-oauth-http-"));
	directories.push(directory);
	const provider = new SqliteOAuthProvider({
		issuerUrl: "http://localhost",
		dbPath: join(directory, "oauth.db"),
	});
	providers.push(provider);
	const handle = await startStreamableHttpServer(
		{ transport: "http+oauth", host: "127.0.0.1", port: 0 },
		"test-api-key",
		() => {
			const server = new McpServer({ name: "test-server", version: "1.0.0" });
			server.registerTool("mock-tool", { description: "A mocked tool" }, () =>
				Promise.resolve({
					content: [{ type: "text" as const, text: "mock result" }],
				}),
			);
			return Promise.resolve(server);
		},
		undefined,
		createOAuthHttpExtensions({
			issuerUrl: "http://localhost",
			provider,
			getPassword: () => password,
		}),
	);
	handles.push(handle);
	const address = handle.server.address();
	const port = address && !isString(address) ? address.port : 0;
	return { port, provider };
}

async function registerClient(port: number) {
	const body = JSON.stringify({
		redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
		client_name: "Claude",
		token_endpoint_auth_method: "none",
	});
	const response = await call(port, "POST", "/register", {
		body,
		headers: {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(body).toString(),
		},
	});
	return {
		response,
		client: JSON.parse(response.body) as {
			client_id: string;
			redirect_uris: string[];
		},
	};
}

function sessionIdFrom(html: string): string {
	const match = /name="session" value="([0-9a-f]{32})"/u.exec(html);
	if (!match) throw new Error("no session id in consent page");
	return match[1] as string;
}

describe("http+oauth transport", () => {
	it("serves authorization server and protected resource metadata", async () => {
		const { port } = await startServer("secret");

		const as = await call(
			port,
			"GET",
			"/.well-known/oauth-authorization-server",
		);
		expect(as.statusCode).toBe(200);
		const metadata = JSON.parse(as.body);
		expect(metadata.issuer).toBe("http://localhost");
		expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
		expect(metadata.registration_endpoint).toBe("http://localhost/register");

		const prm = await call(
			port,
			"GET",
			"/.well-known/oauth-protected-resource/mcp",
		);
		expect(prm.statusCode).toBe(200);
		expect(JSON.parse(prm.body).resource).toBe("http://localhost/mcp");
	});

	it("returns 401 with a WWW-Authenticate challenge for unauthenticated /mcp", async () => {
		const { port } = await startServer("secret");

		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
		});
		const response = await call(port, "POST", "/mcp", {
			body,
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body).toString(),
			},
		});

		expect(response.statusCode).toBe(401);
		expect(String(response.headers["www-authenticate"])).toContain(
			"resource_metadata=",
		);
	});

	it("rejects a bogus bearer token", async () => {
		const { port } = await startServer("secret");
		const response = await call(port, "POST", "/mcp", {
			headers: { Authorization: "Bearer not-a-real-token" },
		});
		expect(response.statusCode).toBe(401);
	});

	it("runs the full DCR + PKCE + consent + token flow and reaches MCP", async () => {
		const { port } = await startServer("secret");
		const { response: registration, client } = await registerClient(port);
		expect(registration.statusCode).toBe(201);

		const verifier = randomBytes(32).toString("base64url");
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.client_id,
			redirect_uri: client.redirect_uris[0] as string,
			scope: "mcp",
			state: "xyz",
			code_challenge: deriveS256Challenge(verifier),
			code_challenge_method: "S256",
		});
		const authorize = await call(port, "GET", `/authorize?${query}`);
		expect(authorize.statusCode).toBe(200);
		expect(authorize.headers["content-type"]).toContain("text/html");

		const consent = await form(port, "/consent", {
			session: sessionIdFrom(authorize.body),
			password: "secret",
		});
		expect(consent.statusCode).toBe(302);
		const redirect = new URL(String(consent.headers.location));
		expect(redirect.searchParams.get("state")).toBe("xyz");
		const code = redirect.searchParams.get("code") as string;

		const token = await form(port, "/token", {
			grant_type: "authorization_code",
			client_id: client.client_id,
			code,
			code_verifier: verifier,
			redirect_uri: client.redirect_uris[0] as string,
		});
		expect(token.statusCode).toBe(200);
		const tokens = JSON.parse(token.body);
		expect(tokens.token_type).toBe("bearer");

		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			},
		});
		const initialize = await call(port, "POST", "/mcp", {
			body,
			headers: {
				Authorization: `Bearer ${tokens.access_token}`,
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body).toString(),
			},
		});
		expect(initialize.statusCode).toBe(200);
		expect(initialize.headers["mcp-session-id"]).toBeTypeOf("string");

		const refreshed = await form(port, "/token", {
			grant_type: "refresh_token",
			client_id: client.client_id,
			refresh_token: tokens.refresh_token,
		});
		expect(refreshed.statusCode).toBe(200);
		expect(JSON.parse(refreshed.body).access_token).not.toBe(
			tokens.access_token,
		);
	});

	it("rejects a token exchange with a mismatched PKCE verifier", async () => {
		const { port } = await startServer("secret");
		const { client } = await registerClient(port);
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.client_id,
			redirect_uri: client.redirect_uris[0] as string,
			code_challenge: deriveS256Challenge("the-real-verifier"),
			code_challenge_method: "S256",
		});
		const authorize = await call(port, "GET", `/authorize?${query}`);
		const consent = await form(port, "/consent", {
			session: sessionIdFrom(authorize.body),
			password: "secret",
		});
		const code = new URL(String(consent.headers.location)).searchParams.get(
			"code",
		) as string;

		const token = await form(port, "/token", {
			grant_type: "authorization_code",
			client_id: client.client_id,
			code,
			code_verifier: "a-different-verifier",
		});
		expect(token.statusCode).toBe(400);
		expect(JSON.parse(token.body).error).toBe("invalid_grant");
	});

	it("refuses /authorize without PKCE", async () => {
		const { port } = await startServer("secret");
		const { client } = await registerClient(port);
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.client_id,
			redirect_uri: client.redirect_uris[0] as string,
		});

		const authorize = await call(port, "GET", `/authorize?${query}`);
		expect(authorize.statusCode).toBe(400);
		expect(authorize.body).toContain("PKCE is required");
	});

	it("refuses an unregistered redirect_uri", async () => {
		const { port } = await startServer("secret");
		const { client } = await registerClient(port);
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.client_id,
			redirect_uri: "https://evil.example.com/callback",
			code_challenge: deriveS256Challenge("v"),
			code_challenge_method: "S256",
		});

		const authorize = await call(port, "GET", `/authorize?${query}`);
		expect(authorize.statusCode).toBe(400);
		expect(authorize.body).toContain("not registered");
	});

	it("locks out every login when MCP_AUTH_PASSWORD is empty", async () => {
		for (const password of ["", undefined]) {
			const { port } = await startServer(password);
			const { client } = await registerClient(port);
			const query = new URLSearchParams({
				response_type: "code",
				client_id: client.client_id,
				redirect_uri: client.redirect_uris[0] as string,
				code_challenge: deriveS256Challenge("v"),
				code_challenge_method: "S256",
			});
			const authorize = await call(port, "GET", `/authorize?${query}`);
			const session = sessionIdFrom(authorize.body);

			for (const attempt of ["", "anything"]) {
				const consent = await form(port, "/consent", {
					session,
					password: attempt,
				});
				expect(consent.statusCode).toBe(401);
				expect(consent.headers.location).toBeUndefined();
				expect(consent.body).toContain("Incorrect password.");
			}
		}
	});

	it("rejects a wrong password without consuming the pending session", async () => {
		const { port } = await startServer("secret");
		const { client } = await registerClient(port);
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.client_id,
			redirect_uri: client.redirect_uris[0] as string,
			code_challenge: deriveS256Challenge("v"),
			code_challenge_method: "S256",
		});
		const authorize = await call(port, "GET", `/authorize?${query}`);
		const session = sessionIdFrom(authorize.body);

		expect(
			(await form(port, "/consent", { session, password: "wrong" })).statusCode,
		).toBe(401);
		expect(
			(await form(port, "/consent", { session, password: "secret" }))
				.statusCode,
		).toBe(302);
	});

	it("rejects a consent post with a malformed session id", async () => {
		const { port } = await startServer("secret");
		const consent = await form(port, "/consent", {
			session: "../../etc/passwd",
			password: "secret",
		});
		expect(consent.statusCode).toBe(400);
		expect(consent.body).toContain("Invalid or missing session parameter");
	});

	it("answers CORS preflight for claude.ai only", async () => {
		const { port } = await startServer("secret");

		const allowed = await call(port, "OPTIONS", "/mcp", {
			headers: { Origin: "https://claude.ai" },
		});
		expect(allowed.statusCode).toBe(204);
		expect(allowed.headers["access-control-allow-origin"]).toBe(
			"https://claude.ai",
		);

		const denied = await call(port, "OPTIONS", "/mcp", {
			headers: { Origin: "https://evil.example.com" },
		});
		expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
	});

	it("revokes a token family through /revoke", async () => {
		const { port } = await startServer("secret");
		const { client } = await registerClient(port);
		const verifier = randomBytes(32).toString("base64url");
		const query = new URLSearchParams({
			response_type: "code",
			client_id: client.client_id,
			redirect_uri: client.redirect_uris[0] as string,
			code_challenge: deriveS256Challenge(verifier),
			code_challenge_method: "S256",
		});
		const authorize = await call(port, "GET", `/authorize?${query}`);
		const consent = await form(port, "/consent", {
			session: sessionIdFrom(authorize.body),
			password: "secret",
		});
		const code = new URL(String(consent.headers.location)).searchParams.get(
			"code",
		) as string;
		const tokens = JSON.parse(
			(
				await form(port, "/token", {
					grant_type: "authorization_code",
					client_id: client.client_id,
					code,
					code_verifier: verifier,
				})
			).body,
		);

		const revoked = await form(port, "/revoke", {
			client_id: client.client_id,
			token: tokens.access_token,
		});
		expect(revoked.statusCode).toBe(200);

		const afterRevoke = await call(port, "POST", "/mcp", {
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		});
		expect(afterRevoke.statusCode).toBe(401);
	});

	it("rejects an unknown client on the token endpoint", async () => {
		const { port } = await startServer("secret");
		const token = await form(port, "/token", {
			grant_type: "authorization_code",
			client_id: "nope",
			code: "abc",
			code_verifier: "v",
		});
		expect(token.statusCode).toBe(401);
		expect(JSON.parse(token.body).error).toBe("invalid_client");
	});
});
