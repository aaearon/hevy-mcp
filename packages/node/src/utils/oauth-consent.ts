import { timingSafeEqual } from "node:crypto";

/**
 * Password-gated consent page for the fork's `http+oauth` transport.
 *
 * The MCP server holds a single Hevy API key, so "who is the user" reduces to
 * "does the operator's shared password match". `MCP_AUTH_PASSWORD` is therefore
 * the only credential, and it fails closed: an empty or unset value rejects
 * every login rather than accepting an empty password.
 */

export const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/iu;
export const CONSENT_PATH = "/consent";

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#x27;");
}

/**
 * Constant-time password check. Returns false whenever `MCP_AUTH_PASSWORD` is
 * unset or empty so a misconfigured deployment cannot be logged into.
 */
export function verifyConsentPassword(
	provided: string,
	expected: string | undefined,
): boolean {
	if (!expected) return false;
	const expectedBuffer = Buffer.from(expected, "utf8");
	const providedBuffer = Buffer.from(provided, "utf8");
	return (
		expectedBuffer.length === providedBuffer.length &&
		timingSafeEqual(expectedBuffer, providedBuffer)
	);
}

export interface ConsentPageOptions {
	sessionId: string;
	clientName: string;
	error?: string;
}

const CONSENT_STYLES = `
	:root { color-scheme: light dark; }
	* { box-sizing: border-box; }
	body {
		margin: 0; min-height: 100vh; display: flex; align-items: center;
		justify-content: center; background: #f3f4f6; color: #111827;
		font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
		padding: 2rem 1rem;
	}
	.card {
		background: #fff; border-radius: 12px; border: 1px solid #e5e7eb;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		padding: 2rem; width: 100%; max-width: 24rem;
	}
	h1 { margin: 0 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
	p { margin: 0 0 1rem; line-height: 1.5; }
	label { display: block; margin-bottom: 0.375rem; font-size: 0.875rem; }
	input[type="password"] {
		width: 100%; padding: 0.5rem 0.75rem; font-size: 1rem;
		border: 1px solid #d1d5db; border-radius: 6px;
		background: inherit; color: inherit;
	}
	button {
		margin-top: 1rem; width: 100%; padding: 0.625rem; font-size: 1rem;
		font-weight: 600; border: none; border-radius: 6px;
		background: #2563eb; color: #fff; cursor: pointer;
	}
	.error {
		background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
		border-radius: 6px; padding: 0.625rem; margin-bottom: 1rem;
	}
	@media (prefers-color-scheme: dark) {
		body { background: #18181b; color: #fafafa; }
		.card { background: #27272a; border-color: #3f3f46; }
		input[type="password"] { border-color: #52525b; }
		.error { background: #450a0a; border-color: #7f1d1d; color: #fca5a5; }
	}
`;

export const CONSENT_HTML_HEADERS: Record<string, string> = {
	"Content-Type": "text/html; charset=utf-8",
	"Cache-Control": "no-store",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
	// No form-action directive: Chrome applies it to the redirect that follows
	// the submission, which would block the 302 back to the OAuth client.
	"Content-Security-Policy":
		"default-src 'none'; style-src 'unsafe-inline'; " +
		"frame-ancestors 'none'; base-uri 'none'",
};

export function renderConsentPage(options: ConsentPageOptions): string {
	const clientName = escapeHtml(options.clientName);
	const sessionId = escapeHtml(options.sessionId);
	const errorBanner = options.error
		? `<div class="error">${escapeHtml(options.error)}</div>`
		: "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize hevy-mcp</title>
<style>${CONSENT_STYLES}</style>
</head>
<body>
<div class="card">
<h1>Authorize hevy-mcp</h1>
<p><strong>${clientName}</strong> is requesting access to this hevy-mcp server.</p>
${errorBanner}
<form method="POST" action="${CONSENT_PATH}">
<input type="hidden" name="session" value="${sessionId}">
<label for="password">Password</label>
<input type="password" id="password" name="password" autocomplete="off" autofocus required>
<button type="submit">Authorize</button>
</form>
</div>
</body>
</html>`;
}

export function renderConsentError(message: string): string {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorization error</title></head>
<body><p>${escapeHtml(message)}</p></body>
</html>`;
}
