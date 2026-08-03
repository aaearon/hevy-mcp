import { SAFE_OBSERVATION_CODES } from "@hevy-mcp/hevy-client";
import type {
	HevyClientOptions,
	HevyRequestObservation,
} from "@hevy-mcp/hevy-client";
import { bucketCount } from "@hevy-mcp/core";
import { debugLog } from "./debug.js";

function safeErrorAttributes(observation: HevyRequestObservation): {
	error_category?: string;
	error_code?: string;
} {
	if (!observation.error) return {};
	const code = observation.error.code;
	return {
		error_category: observation.error.category ?? "HevyHttpError",
		...(code && SAFE_OBSERVATION_CODES.has(code) ? { error_code: code } : {}),
	};
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
