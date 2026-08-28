import { z } from "zod";

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
		const parsedColo = z
			.string()
			.safeParse((request as RequestWithCloudflareProperties).cf?.colo).data;
		return parsedColo !== undefined && CLOUDFLARE_COLO_PATTERN.test(parsedColo)
			? parsedColo
			: undefined;
	} catch {
		// Request metadata is optional and must never affect MCP behavior.
		return undefined;
	}
}
