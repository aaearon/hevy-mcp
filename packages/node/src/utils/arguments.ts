import { isIP } from "node:net";

export type NodeTransport = "stdio" | "http" | "http+oauth";

export interface NodeCliOptions {
	transport: NodeTransport;
	host: string;
	port: number;
	/**
	 * Public base URL of this server, required by `--transport http+oauth`.
	 * Falls back to `MCP_ISSUER_URL`.
	 */
	issuerUrl?: string;
}

const TRANSPORTS: readonly NodeTransport[] = ["stdio", "http", "http+oauth"];

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

function valueAfter(args: string[], index: number, option: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("-")) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
}

function parseHost(value: string): string {
	const host = value.trim();
	const unbracketed =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	const isBracketed = host.startsWith("[") || host.endsWith("]");
	const validHostname =
		/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
	if (
		host.length === 0 ||
		(isBracketed && !(host.startsWith("[") && host.endsWith("]"))) ||
		(isBracketed && isIP(unbracketed) !== 6) ||
		(!isBracketed && host.includes(":") && isIP(host) !== 6) ||
		(!isBracketed &&
			!host.includes(":") &&
			isIP(host) === 0 &&
			!validHostname.test(host)) ||
		/\s/u.test(host) ||
		host.includes("/") ||
		host.includes("@") ||
		host.includes("://")
	) {
		throw new Error(
			`Invalid host: ${value}. Provide a hostname or IP address.`,
		);
	}
	return unbracketed;
}

function parsePort(value: string): number {
	if (!/^[0-9]+$/u.test(value)) {
		throw new Error(`Invalid port: ${value}. Use an integer from 1 to 65535.`);
	}
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid port: ${value}. Use an integer from 1 to 65535.`);
	}
	return port;
}

function parseIssuerUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid issuer URL: ${value}. Provide an absolute URL.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Invalid issuer URL: ${value}. Use http or https.`);
	}
	return url.origin + url.pathname.replace(/\/+$/u, "");
}

export function parseNodeCliOptions(
	args: string[],
	env: NodeJS.ProcessEnv = process.env,
): NodeCliOptions {
	let transport: NodeTransport = "stdio";
	let host = DEFAULT_HOST;
	let port = DEFAULT_PORT;
	let issuerUrl: string | undefined;
	let transportExplicit = false;
	let hostExplicit = false;
	let portExplicit = false;

	for (let index = 0; index < args.length; index += 1) {
		const raw = args[index];
		if (!raw || ["--help", "-h", "--version", "-v"].includes(raw)) {
			continue;
		}
		// Support both `--option value` and `--option=value`.
		const separator = raw.indexOf("=");
		const arg = separator > 0 ? raw.slice(0, separator) : raw;
		const inlineValue = separator > 0 ? raw.slice(separator + 1) : undefined;
		const takeValue = (): string => {
			if (inlineValue !== undefined) {
				if (!inlineValue) throw new Error(`${arg} requires a value.`);
				return inlineValue;
			}
			const value = valueAfter(args, index, arg);
			index += 1;
			return value;
		};
		switch (arg) {
			case "--transport": {
				const value = takeValue();
				if (!TRANSPORTS.includes(value as NodeTransport)) {
					throw new Error(
						`Invalid transport: ${value}. Use stdio, http, or http+oauth.`,
					);
				}
				transport = value as NodeTransport;
				transportExplicit = true;
				break;
			}
			case "--host":
				host = parseHost(takeValue());
				hostExplicit = true;
				break;
			case "--port":
				port = parsePort(takeValue());
				portExplicit = true;
				break;
			case "--issuer-url":
				issuerUrl = parseIssuerUrl(takeValue());
				break;
			default:
				throw new Error(`Unknown option: ${raw}`);
		}
	}

	if (transport === "stdio" && (hostExplicit || portExplicit)) {
		throw new Error(
			"--host and --port can only be used with --transport http.",
		);
	}
	if (transport === "stdio" && transportExplicit) {
		return { transport, host: DEFAULT_HOST, port: DEFAULT_PORT };
	}
	if (transport === "http+oauth") {
		const configured = issuerUrl ?? env.MCP_ISSUER_URL;
		if (!configured) {
			throw new Error(
				"--transport http+oauth requires --issuer-url or MCP_ISSUER_URL.",
			);
		}
		return { transport, host, port, issuerUrl: parseIssuerUrl(configured) };
	}
	return { transport, host, port, issuerUrl };
}
