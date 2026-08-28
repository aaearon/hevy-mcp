import { SAFE_OBSERVATION_CODES } from "@hevy-mcp/hevy-client";
import type {
	HevyClientOptions,
	HevyRequestObservation,
} from "@hevy-mcp/hevy-client";
import { bucketCount } from "@hevy-mcp/core";
import { debugLog } from "./debug.js";

/** Named contract so the return type is a resolvable owner type, not an anonymous object literal. */
type SafeErrorAttributes = {
	error_category?: string;
	error_code?: string;
};

function safeErrorAttributes(
	observation: HevyRequestObservation,
): SafeErrorAttributes {
	if (!observation.error) return {};
	const code = observation.error.code;
	const attributes: SafeErrorAttributes = {
		error_category: observation.error.category ?? "HevyHttpError",
	};
	if (code && SAFE_OBSERVATION_CODES.has(code)) {
		attributes.error_code = code;
	}
	return attributes;
}

/**
 * Hevy client observation hooks used purely for opt-in local diagnostics
 * (`HEVY_MCP_DEBUG=1`). Nothing here leaves the process.
 */
export function createNodeHevyClientOptions(): Partial<HevyClientOptions> {
	return {
		onRequestComplete(observation) {
			debugLog("api_response", {
				method: observation.method,
				endpoint: observation.endpoint,
				durationMs: observation.durationMs,
				status: observation.status || null,
				retryCountBucket: bucketCount(observation.retryCount),
				outcome: observation.outcome,
				...safeErrorAttributes(observation),
			});
		},
	};
}
