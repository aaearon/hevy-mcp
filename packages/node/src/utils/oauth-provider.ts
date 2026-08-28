import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import {
	OAuthError,
	OAuthErrorCode,
	type AuthInfo,
	type OAuthClientInformationFull,
	type OAuthMetadata,
	type OAuthTokenVerifier,
	type OAuthTokens,
} from "@modelcontextprotocol/server";
import { z } from "zod";

/**
 * SQLite-backed OAuth 2.1 authorization server state.
 *
 * `@modelcontextprotocol/server` v2 no longer ships the v1 `OAuthServerProvider`
 * interface or the Express `mcpAuthRouter`; the only server-side OAuth surface
 * left is {@link OAuthTokenVerifier} plus the bearer-auth/metadata helpers. This
 * class therefore owns the full authorization-server behaviour (dynamic client
 * registration, PKCE authorization codes, access/refresh token rotation and
 * revocation) and exposes `verifyAccessToken` so the resource-server side can
 * keep using the SDK's bearer helpers.
 *
 * Tokens live in SQLite (`OAUTH_DB_PATH`, default `./oauth.db`) so that grants
 * survive a process restart — a claude.ai Connector must not be forced to
 * re-authorize every deploy.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 300;
export const PENDING_SESSION_TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING_SESSIONS = 1000;
export const DEFAULT_OAUTH_DB_PATH = "./oauth.db";
export const OAUTH_SCOPES = ["mcp"] as const;

/** Hex session id handed to the consent page. */
const SESSION_ID_BYTES = 16;

/**
 * RFC 7591 dynamic client registration metadata. Deliberately a local schema
 * rather than the SDK's internal `OAuthClientMetadataSchema`, which is only
 * reachable through the unsupported `@modelcontextprotocol/core/internal`
 * subpath.
 */
const clientMetadataSchema = z.looseObject({
	redirect_uris: z.array(z.url()).min(1),
	client_name: z.string().optional(),
	client_uri: z.string().optional(),
	logo_uri: z.string().optional(),
	scope: z.string().optional(),
	contacts: z.array(z.string()).optional(),
	tos_uri: z.string().optional(),
	policy_uri: z.string().optional(),
	software_id: z.string().optional(),
	software_version: z.string().optional(),
	token_endpoint_auth_method: z.string().optional(),
	grant_types: z.array(z.string()).optional(),
	response_types: z.array(z.string()).optional(),
});

export interface AuthorizationRequest {
	clientId: string;
	redirectUri: string;
	scopes: string[];
	state?: string;
	codeChallenge: string;
	resource?: string;
}

export interface PendingAuthorization {
	client: OAuthClientInformationFull;
	request: AuthorizationRequest;
	expiresAt: number;
}

export interface SqliteOAuthProviderOptions {
	issuerUrl: string;
	dbPath?: string;
}

interface ClientRow {
	data_json: string;
}

interface AuthCodeRow {
	client_id: string;
	scopes: string;
	expires_at: number;
	code_challenge: string;
	redirect_uri: string;
	resource: string | null;
}

interface RefreshTokenRow {
	client_id: string;
	scopes: string;
	expires_at: number;
	family_id: string;
}

interface AccessTokenRow {
	client_id: string;
	scopes: string;
	expires_at: number;
	resource: string | null;
}

const SCHEMA = `
	CREATE TABLE IF NOT EXISTS clients (
		client_id TEXT PRIMARY KEY,
		data_json TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS auth_codes (
		code TEXT PRIMARY KEY,
		client_id TEXT NOT NULL,
		scopes TEXT NOT NULL,
		expires_at REAL NOT NULL,
		code_challenge TEXT NOT NULL,
		redirect_uri TEXT NOT NULL,
		resource TEXT
	);
	CREATE TABLE IF NOT EXISTS access_tokens (
		token TEXT PRIMARY KEY,
		client_id TEXT NOT NULL,
		scopes TEXT NOT NULL,
		expires_at INTEGER NOT NULL,
		resource TEXT,
		family_id TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS refresh_tokens (
		token TEXT PRIMARY KEY,
		client_id TEXT NOT NULL,
		scopes TEXT NOT NULL,
		expires_at INTEGER NOT NULL,
		family_id TEXT NOT NULL
	);
`;

/**
 * `better-sqlite3` is a native addon and is only needed by the `http+oauth`
 * transport. Resolving it through `createRequire` at first use keeps it out of
 * the bundled standalone artifact (which stdio users run) and out of the
 * startup path entirely.
 */
function loadDatabaseConstructor(): typeof Database {
	const require = createRequire(import.meta.url);
	return require("better-sqlite3") as typeof Database;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function constantTimeEquals(a: string, b: string): boolean {
	const left = Buffer.from(a, "utf8");
	const right = Buffer.from(b, "utf8");
	return left.length === right.length && timingSafeEqual(left, right);
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export function deriveS256Challenge(codeVerifier: string): string {
	return createHash("sha256").update(codeVerifier).digest("base64url");
}

export class SqliteOAuthProvider implements OAuthTokenVerifier {
	readonly issuerUrl: string;
	readonly dbPath: string;
	private database: Database.Database | null = null;
	private readonly pendingSessions = new Map<string, PendingAuthorization>();

	constructor(options: SqliteOAuthProviderOptions) {
		this.issuerUrl = options.issuerUrl.replace(/\/+$/u, "");
		this.dbPath =
			options.dbPath ?? process.env.OAUTH_DB_PATH ?? DEFAULT_OAUTH_DB_PATH;
	}

	private get db(): Database.Database {
		if (!this.database) {
			const DatabaseConstructor = loadDatabaseConstructor();
			this.database = new DatabaseConstructor(this.dbPath);
			this.database.pragma("journal_mode = WAL");
			this.database.exec(SCHEMA);
		}
		return this.database;
	}

	close(): void {
		this.database?.close();
		this.database = null;
	}

	/** RFC 8414 authorization server metadata for this issuer. */
	metadata(): OAuthMetadata {
		return {
			issuer: this.issuerUrl,
			authorization_endpoint: `${this.issuerUrl}/authorize`,
			token_endpoint: `${this.issuerUrl}/token`,
			registration_endpoint: `${this.issuerUrl}/register`,
			revocation_endpoint: `${this.issuerUrl}/revoke`,
			scopes_supported: [...OAUTH_SCOPES],
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: [
				"none",
				"client_secret_post",
				"client_secret_basic",
			],
			revocation_endpoint_auth_methods_supported: [
				"none",
				"client_secret_post",
				"client_secret_basic",
			],
		};
	}

	// --- Client registration ------------------------------------------------

	getClient(clientId: string): OAuthClientInformationFull | undefined {
		const row = this.db
			.prepare("SELECT data_json FROM clients WHERE client_id = ?")
			.get(clientId) as ClientRow | undefined;
		if (!row) return undefined;
		return JSON.parse(row.data_json) as OAuthClientInformationFull;
	}

	registerClient<T>(metadata: T): OAuthClientInformationFull {
		const parsed = clientMetadataSchema.safeParse(metadata);
		if (!parsed.success) {
			throw new OAuthError(
				OAuthErrorCode.InvalidClientMetadata,
				"Client metadata is invalid: redirect_uris must contain at least one absolute URL.",
			);
		}
		const client: OAuthClientInformationFull = {
			...parsed.data,
			client_id: randomUUID(),
			client_id_issued_at: nowSeconds(),
		};
		this.db
			.prepare("INSERT INTO clients (client_id, data_json) VALUES (?, ?)")
			.run(client.client_id, JSON.stringify(client));
		return client;
	}

	// --- Pending (pre-consent) authorizations -------------------------------

	createPendingAuthorization(
		client: OAuthClientInformationFull,
		request: AuthorizationRequest,
	): string {
		this.evictExpiredSessions();
		if (this.pendingSessions.size >= MAX_PENDING_SESSIONS) {
			const oldest = this.pendingSessions.keys().next().value;
			if (oldest) this.pendingSessions.delete(oldest);
		}
		const sessionId = randomBytes(SESSION_ID_BYTES).toString("hex");
		this.pendingSessions.set(sessionId, {
			client,
			request,
			expiresAt: Date.now() + PENDING_SESSION_TTL_MS,
		});
		return sessionId;
	}

	popPendingAuthorization(sessionId: string): PendingAuthorization | undefined {
		const pending = this.pendingSessions.get(sessionId);
		this.pendingSessions.delete(sessionId);
		if (!pending || pending.expiresAt <= Date.now()) return undefined;
		return pending;
	}

	private evictExpiredSessions(): void {
		const now = Date.now();
		for (const [id, pending] of this.pendingSessions) {
			if (pending.expiresAt <= now) this.pendingSessions.delete(id);
		}
	}

	// --- Authorization codes -------------------------------------------------

	createAuthorizationCode(request: AuthorizationRequest): string {
		const code = randomBytes(32).toString("hex");
		this.db
			.prepare(
				`INSERT INTO auth_codes
				(code, client_id, scopes, expires_at, code_challenge, redirect_uri, resource)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				code,
				request.clientId,
				JSON.stringify(request.scopes),
				nowSeconds() + AUTHORIZATION_CODE_TTL_SECONDS,
				request.codeChallenge,
				request.redirectUri,
				request.resource ?? null,
			);
		return code;
	}

	/**
	 * Redeem an authorization code. PKCE is mandatory: the stored challenge is
	 * always present (the authorize endpoint rejects requests without one) and
	 * the verifier must hash to it, so a stolen code alone is useless.
	 */
	exchangeAuthorizationCode(
		client: OAuthClientInformationFull,
		code: string,
		codeVerifier: string | undefined,
		redirectUri?: string,
	): OAuthTokens {
		const row = this.db
			.prepare(
				`SELECT client_id, scopes, expires_at, code_challenge, redirect_uri, resource
				FROM auth_codes WHERE code = ?`,
			)
			.get(code) as AuthCodeRow | undefined;

		if (!row) {
			throw new OAuthError(
				OAuthErrorCode.InvalidGrant,
				"Authorization code not found.",
			);
		}
		if (row.client_id !== client.client_id) {
			throw new OAuthError(
				OAuthErrorCode.InvalidGrant,
				"Authorization code was issued to a different client.",
			);
		}
		if (row.expires_at < nowSeconds()) {
			this.db.prepare("DELETE FROM auth_codes WHERE code = ?").run(code);
			throw new OAuthError(
				OAuthErrorCode.InvalidGrant,
				"Authorization code expired.",
			);
		}
		if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
			throw new OAuthError(
				OAuthErrorCode.InvalidGrant,
				"Redirect URI mismatch.",
			);
		}
		if (!codeVerifier) {
			throw new OAuthError(
				OAuthErrorCode.InvalidRequest,
				"code_verifier is required (PKCE).",
			);
		}
		if (
			!constantTimeEquals(deriveS256Challenge(codeVerifier), row.code_challenge)
		) {
			throw new OAuthError(
				OAuthErrorCode.InvalidGrant,
				"PKCE verification failed.",
			);
		}

		const scopes = JSON.parse(row.scopes) as string[];
		const resource = row.resource;
		return this.db.transaction((): OAuthTokens => {
			const deleted = this.db
				.prepare("DELETE FROM auth_codes WHERE code = ?")
				.run(code);
			if (deleted.changes === 0) {
				throw new OAuthError(
					OAuthErrorCode.InvalidGrant,
					"Authorization code already used.",
				);
			}
			return this.mintTokens(client.client_id, scopes, randomUUID(), resource);
		})();
	}

	// --- Refresh -------------------------------------------------------------

	exchangeRefreshToken(
		client: OAuthClientInformationFull,
		refreshToken: string,
		scopes?: string[],
	): OAuthTokens {
		return this.db.transaction((): OAuthTokens => {
			const row = this.db
				.prepare(
					`SELECT client_id, scopes, expires_at, family_id
					FROM refresh_tokens WHERE token = ?`,
				)
				.get(refreshToken) as RefreshTokenRow | undefined;

			if (!row) {
				throw new OAuthError(
					OAuthErrorCode.InvalidGrant,
					"Refresh token not found.",
				);
			}
			if (row.client_id !== client.client_id) {
				throw new OAuthError(
					OAuthErrorCode.InvalidGrant,
					"Refresh token was issued to a different client.",
				);
			}
			if (row.expires_at < nowSeconds()) {
				throw new OAuthError(
					OAuthErrorCode.InvalidGrant,
					"Refresh token expired.",
				);
			}

			const granted = JSON.parse(row.scopes) as string[];
			if (scopes?.length) {
				const invalid = scopes.filter((scope) => !granted.includes(scope));
				if (invalid.length > 0) {
					throw new OAuthError(
						OAuthErrorCode.InvalidScope,
						`Requested scopes exceed granted scopes: ${invalid.join(", ")}`,
					);
				}
			}

			const deleted = this.db
				.prepare("DELETE FROM refresh_tokens WHERE token = ?")
				.run(refreshToken);
			if (deleted.changes === 0) {
				throw new OAuthError(
					OAuthErrorCode.InvalidGrant,
					"Refresh token already used.",
				);
			}
			return this.mintTokens(
				client.client_id,
				scopes?.length ? scopes : granted,
				row.family_id,
				null,
			);
		})();
	}

	private mintTokens(
		clientId: string,
		scopes: string[],
		familyId: string,
		resource: string | null,
	): OAuthTokens {
		const accessToken = randomBytes(32).toString("hex");
		const refreshToken = randomBytes(32).toString("hex");
		const issuedAt = nowSeconds();
		this.db
			.prepare(
				`INSERT INTO access_tokens (token, client_id, scopes, expires_at, resource, family_id)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				accessToken,
				clientId,
				JSON.stringify(scopes),
				issuedAt + ACCESS_TOKEN_TTL_SECONDS,
				resource,
				familyId,
			);
		this.db
			.prepare(
				`INSERT INTO refresh_tokens (token, client_id, scopes, expires_at, family_id)
				VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				refreshToken,
				clientId,
				JSON.stringify(scopes),
				issuedAt + REFRESH_TOKEN_TTL_SECONDS,
				familyId,
			);
		return {
			access_token: accessToken,
			token_type: "bearer",
			expires_in: ACCESS_TOKEN_TTL_SECONDS,
			scope: scopes.join(" "),
			refresh_token: refreshToken,
		};
	}

	// --- Resource-server verification ---------------------------------------

	// eslint-disable-next-line @typescript-eslint/require-await -- SDK contract is async.
	async verifyAccessToken(token: string): Promise<AuthInfo> {
		const row = this.db
			.prepare(
				`SELECT client_id, scopes, expires_at, resource
				FROM access_tokens WHERE token = ?`,
			)
			.get(token) as AccessTokenRow | undefined;

		if (!row) {
			throw new OAuthError(
				OAuthErrorCode.InvalidToken,
				"Access token is not recognized.",
			);
		}
		if (row.expires_at < nowSeconds()) {
			throw new OAuthError(
				OAuthErrorCode.InvalidToken,
				"Access token expired.",
			);
		}
		return {
			token,
			clientId: row.client_id,
			scopes: JSON.parse(row.scopes) as string[],
			expiresAt: row.expires_at,
		};
	}

	/** RFC 7009 revocation: drops the whole token family. */
	revokeToken(token: string): void {
		const accessRow = this.db
			.prepare("SELECT family_id FROM access_tokens WHERE token = ?")
			.get(token) as { family_id: string } | undefined;
		const refreshRow = accessRow
			? undefined
			: (this.db
					.prepare("SELECT family_id FROM refresh_tokens WHERE token = ?")
					.get(token) as { family_id: string } | undefined);
		const familyId = (accessRow ?? refreshRow)?.family_id;
		if (!familyId) return;
		this.db
			.prepare("DELETE FROM access_tokens WHERE family_id = ?")
			.run(familyId);
		this.db
			.prepare("DELETE FROM refresh_tokens WHERE family_id = ?")
			.run(familyId);
	}

	/** Authenticate a token/revocation request against the stored client. */
	authenticateClient(
		clientId: string,
		clientSecret: string | undefined,
	): OAuthClientInformationFull {
		const client = this.getClient(clientId);
		if (!client) {
			throw new OAuthError(
				OAuthErrorCode.InvalidClient,
				"Unknown OAuth client.",
			);
		}
		if (client.client_secret) {
			if (
				!clientSecret ||
				!constantTimeEquals(clientSecret, client.client_secret)
			) {
				throw new OAuthError(
					OAuthErrorCode.InvalidClient,
					"Client authentication failed.",
				);
			}
		}
		return client;
	}
}
