/**
 * Build-time service identity for the Node package.
 *
 * `__HEVY_MCP_NAME__` and `__HEVY_MCP_VERSION__` are injected by tsdown at
 * build time. When running from source (tests, `npm run dev`) they are
 * undefined and the fallbacks below apply.
 */

declare const __HEVY_MCP_NAME__: string | undefined;
declare const __HEVY_MCP_VERSION__: string | undefined;

const name =
	typeof __HEVY_MCP_NAME__ === "string" ? __HEVY_MCP_NAME__ : "hevy-mcp";
const version =
	typeof __HEVY_MCP_VERSION__ === "string" ? __HEVY_MCP_VERSION__ : "dev";

/**
 * Bundled service identity — avoids passing name and version as
 * separate primitives throughout the codebase (Data Clumps smell).
 */
export interface ServiceInfo {
	readonly name: string;
	readonly version: string;
}

export const serviceInfo: ServiceInfo = { name, version } as const;
export const serviceName = name;
export const serviceVersion = version;
