import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
	OAuthError,
	type OAuthClientInformationFull,
} from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import {
	ACCESS_TOKEN_TTL_SECONDS,
	SqliteOAuthProvider,
	deriveS256Challenge,
	type AuthorizationRequest,
} from "./oauth-provider.js";

const directories: string[] = [];
const providers: SqliteOAuthProvider[] = [];

afterEach(() => {
	for (const provider of providers.splice(0)) provider.close();
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function createDbPath(): string {
	const directory = mkdtempSync(join(tmpdir(), "hevy-oauth-"));
	directories.push(directory);
	return join(directory, "oauth.db");
}

function createProvider(dbPath: string): SqliteOAuthProvider {
	const provider = new SqliteOAuthProvider({
		issuerUrl: "https://mcp.example.com",
		dbPath,
	});
	providers.push(provider);
	return provider;
}

function register(provider: SqliteOAuthProvider): OAuthClientInformationFull {
	return provider.registerClient({
		redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
		client_name: "Claude",
		token_endpoint_auth_method: "none",
	});
}

function authorizationRequest(
	client: OAuthClientInformationFull,
	codeChallenge: string,
): AuthorizationRequest {
	return {
		clientId: client.client_id,
		redirectUri: client.redirect_uris[0]!,
		scopes: ["mcp"],
		state: "state-value",
		codeChallenge,
	};
}

describe("SqliteOAuthProvider", () => {
	it("registers a dynamic client and reads it back", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);

		expect(client.client_id).toMatch(/[0-9a-f-]{36}/u);
		expect(client.client_id_issued_at).toBeTypeOf("number");
		expect(provider.getClient(client.client_id)?.client_name).toBe("Claude");
		expect(provider.getClient("does-not-exist")).toBeUndefined();
	});

	it("rejects client metadata without usable redirect URIs", () => {
		const provider = createProvider(createDbPath());
		expect(() => provider.registerClient({ redirect_uris: [] })).toThrow(
			OAuthError,
		);
		expect(() =>
			provider.registerClient({ redirect_uris: ["not-a-url"] }),
		).toThrow(OAuthError);
	});

	it("completes the PKCE authorization code flow", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const code = provider.createAuthorizationCode(
			authorizationRequest(client, deriveS256Challenge(verifier)),
		);

		const tokens = provider.exchangeAuthorizationCode(
			client,
			code,
			verifier,
			client.redirect_uris[0],
		);

		expect(tokens.token_type).toBe("bearer");
		expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
		expect(tokens.scope).toBe("mcp");
		expect(tokens.refresh_token).toBeTypeOf("string");
	});

	it("rejects a mismatched PKCE verifier and a missing verifier", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const request = authorizationRequest(client, deriveS256Challenge(verifier));

		const firstCode = provider.createAuthorizationCode(request);
		expect(() =>
			provider.exchangeAuthorizationCode(client, firstCode, "wrong-verifier"),
		).toThrow(/PKCE verification failed/u);

		const secondCode = provider.createAuthorizationCode(request);
		expect(() =>
			provider.exchangeAuthorizationCode(client, secondCode, undefined),
		).toThrow(/code_verifier is required/u);
	});

	it("rejects redirect URI mismatch and cross-client code redemption", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const other = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const request = authorizationRequest(client, deriveS256Challenge(verifier));

		const code = provider.createAuthorizationCode(request);
		expect(() =>
			provider.exchangeAuthorizationCode(
				client,
				code,
				verifier,
				"https://evil.example.com/callback",
			),
		).toThrow(/Redirect URI mismatch/u);
		expect(() =>
			provider.exchangeAuthorizationCode(other, code, verifier),
		).toThrow(/different client/u);
	});

	it("consumes an authorization code exactly once", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const code = provider.createAuthorizationCode(
			authorizationRequest(client, deriveS256Challenge(verifier)),
		);

		provider.exchangeAuthorizationCode(client, code, verifier);
		expect(() =>
			provider.exchangeAuthorizationCode(client, code, verifier),
		).toThrow(/not found/u);
	});

	it("rotates refresh tokens and invalidates the used one", async () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const code = provider.createAuthorizationCode(
			authorizationRequest(client, deriveS256Challenge(verifier)),
		);
		const first = provider.exchangeAuthorizationCode(client, code, verifier);

		const second = provider.exchangeRefreshToken(
			client,
			first.refresh_token as string,
		);
		expect(second.access_token).not.toBe(first.access_token);
		expect(second.refresh_token).not.toBe(first.refresh_token);
		await expect(
			provider.verifyAccessToken(second.access_token),
		).resolves.toMatchObject({ clientId: client.client_id, scopes: ["mcp"] });

		expect(() =>
			provider.exchangeRefreshToken(client, first.refresh_token as string),
		).toThrow(/not found/u);
	});

	it("refuses refresh scope escalation", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const code = provider.createAuthorizationCode(
			authorizationRequest(client, deriveS256Challenge(verifier)),
		);
		const tokens = provider.exchangeAuthorizationCode(client, code, verifier);

		expect(() =>
			provider.exchangeRefreshToken(client, tokens.refresh_token as string, [
				"admin",
			]),
		).toThrow(/exceed granted scopes/u);
	});

	it("persists clients and tokens across a provider restart", async () => {
		const dbPath = createDbPath();
		const first = createProvider(dbPath);
		const client = register(first);
		const verifier = randomBytes(32).toString("base64url");
		const code = first.createAuthorizationCode(
			authorizationRequest(client, deriveS256Challenge(verifier)),
		);
		const tokens = first.exchangeAuthorizationCode(client, code, verifier);
		first.close();

		const restarted = createProvider(dbPath);
		expect(restarted.getClient(client.client_id)?.client_name).toBe("Claude");
		await expect(
			restarted.verifyAccessToken(tokens.access_token),
		).resolves.toMatchObject({ clientId: client.client_id });
		expect(
			restarted.exchangeRefreshToken(client, tokens.refresh_token as string)
				.access_token,
		).toBeTypeOf("string");
	});

	it("rejects unknown and expired access tokens", async () => {
		const provider = createProvider(createDbPath());
		await expect(provider.verifyAccessToken("nope")).rejects.toThrow(
			/not recognized/u,
		);
	});

	it("revokes the whole token family", async () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const verifier = randomBytes(32).toString("base64url");
		const code = provider.createAuthorizationCode(
			authorizationRequest(client, deriveS256Challenge(verifier)),
		);
		const tokens = provider.exchangeAuthorizationCode(client, code, verifier);

		provider.revokeToken(tokens.refresh_token as string);

		await expect(
			provider.verifyAccessToken(tokens.access_token),
		).rejects.toThrow(OAuthError);
		expect(() =>
			provider.exchangeRefreshToken(client, tokens.refresh_token as string),
		).toThrow(/not found/u);
	});

	it("authenticates confidential clients in constant time", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		expect(
			provider.authenticateClient(client.client_id, undefined).client_id,
		).toBe(client.client_id);
		expect(() => provider.authenticateClient("unknown", undefined)).toThrow(
			/Unknown OAuth client/u,
		);
	});

	it("expires pending consent sessions and pops them once", () => {
		const provider = createProvider(createDbPath());
		const client = register(provider);
		const request = authorizationRequest(client, deriveS256Challenge("v"));
		const sessionId = provider.createPendingAuthorization(client, request);

		expect(sessionId).toMatch(/^[0-9a-f]{32}$/u);
		expect(provider.popPendingAuthorization(sessionId)?.request).toEqual(
			request,
		);
		expect(provider.popPendingAuthorization(sessionId)).toBeUndefined();
	});

	it("advertises S256-only PKCE in its metadata", () => {
		const provider = createProvider(createDbPath());
		const metadata = provider.metadata();
		expect(metadata.issuer).toBe("https://mcp.example.com");
		expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
		expect(metadata.authorization_endpoint).toBe(
			"https://mcp.example.com/authorize",
		);
	});
});
