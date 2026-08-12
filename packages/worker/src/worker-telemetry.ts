const CLOUDFLARE_COLO_PATTERN = /^[A-Z]{3}$/u;

type RequestWithCloudflareProperties = Request & {
	readonly cf?: {
		readonly colo?: unknown;
	};
};

/**
 * Return the Cloudflare edge colo only when the Worker supplied a valid value.
 * Local Requests do not have `cf`, so they deliberately produce no colo.
 */
export function getCloudflareColo(request: Request): string | undefined {
	try {
		const colo = (request as RequestWithCloudflareProperties).cf?.colo;
		return typeof colo === "string" && CLOUDFLARE_COLO_PATTERN.test(colo)
			? colo
			: undefined;
	} catch {
		// Request metadata is optional and must never affect MCP behavior.
		return undefined;
	}
}
