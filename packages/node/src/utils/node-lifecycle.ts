import { installGracefulShutdown } from "./graceful-shutdown.js";

export const INVALID_API_KEY_MESSAGE =
	"HEVY_API_KEY is invalid or expired. Please check your API key in the Hevy app under Settings > API Key.";

type LifecycleTerminationReason =
	| "connect_failure"
	| "runtime_failure"
	| "startup_failure";

export type NodeLifecycleTransport = "stdio" | "http";

export interface NodeLifecycleContext {
	readonly signal: AbortSignal;
	/** Mark the beginning of a stdio transport connection attempt. */
	markConnectAttempted(): void;
	/** Mark a successful stdio transport connection. */
	markConnectSucceeded(): void;
	/** Mark the HTTP listener as successfully started. */
	markListening(): void;
}

export type NodeLifecycleOutcome =
	| {
			transport: "stdio";
			connectAttempted: boolean;
			connectSucceeded: boolean;
	  }
	| {
			transport: "http";
			listening: boolean;
	  };

export interface NodeLifecycleStartupResult {
	target: { close(): Promise<void> };
	onShutdown?: (succeeded: boolean) => void | Promise<void>;
}

export interface RunNodeLifecycleOptions {
	transport: NodeLifecycleTransport;
	readonly start: (
		context: NodeLifecycleContext,
	) => Promise<NodeLifecycleStartupResult>;
	readonly onFailure?: (
		reason: LifecycleTerminationReason,
		outcome: NodeLifecycleOutcome,
	) => void;
}

function createOutcomeState(transport: NodeLifecycleTransport) {
	let connectAttempted = false;
	let connectSucceeded = false;
	let listening = false;
	return {
		markConnectAttempted: () => {
			connectAttempted = true;
		},
		markConnectSucceeded: () => {
			connectSucceeded = true;
		},
		markListening: () => {
			listening = true;
		},
		getOutcome: (): NodeLifecycleOutcome =>
			transport === "stdio"
				? { transport, connectAttempted, connectSucceeded }
				: { transport, listening },
	};
}

function classifyFailure(
	outcome: NodeLifecycleOutcome,
): LifecycleTerminationReason {
	if (outcome.transport === "stdio") {
		if (outcome.connectAttempted && !outcome.connectSucceeded) {
			return "connect_failure";
		}
		return outcome.connectSucceeded ? "runtime_failure" : "startup_failure";
	}
	return outcome.listening ? "runtime_failure" : "startup_failure";
}

/**
 * Owns process-wide Node lifecycle concerns while leaving transport state
 * local.
 *
 * This fork ships no runtime telemetry, so the upstream tracing, metric and
 * npm-registry update-check hooks are deliberately absent here. Do not
 * reintroduce them; see the "No Telemetry, No Phone-Home" section of
 * CLAUDE.md.
 */
export async function runNodeLifecycle({
	transport,
	start,
	onFailure,
}: RunNodeLifecycleOptions): Promise<void> {
	const lifecycleController = new AbortController();
	const state = createOutcomeState(transport);
	const context: NodeLifecycleContext = {
		signal: lifecycleController.signal,
		markConnectAttempted: () => state.markConnectAttempted(),
		markConnectSucceeded: () => state.markConnectSucceeded(),
		markListening: () => state.markListening(),
	};

	try {
		const result = await start(context);
		installGracefulShutdown({
			target: result.target,
			cancel: lifecycleController,
			onComplete: async (succeeded) => {
				await result.onShutdown?.(succeeded);
			},
		});
	} catch (error) {
		const outcome = state.getOutcome();
		onFailure?.(classifyFailure(outcome), outcome);
		throw error;
	}
}

export type { LifecycleTerminationReason };
