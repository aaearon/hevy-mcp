import { Data, Effect, Exit, Scope } from "effect";
import { installGracefulShutdown } from "./graceful-shutdown.js";
export { INVALID_API_KEY_MESSAGE } from "./startup-errors.js";

type LifecycleTerminationReason =
	| "connect_failure"
	| "runtime_failure"
	| "startup_failure";

class LifecycleFailure extends Data.TaggedError("LifecycleFailure")<{
	readonly cause: Error | string;
}> {}

function toLifecycleFailure(cause: unknown): LifecycleFailure {
	return new LifecycleFailure({
		cause: cause instanceof Error ? cause : String(cause),
	});
}

export type NodeLifecycleTransport = "stdio" | "http";

export interface NodeLifecycleContext {
	readonly signal: AbortSignal;
	/** Mark the beginning of a stdio transport connection attempt. */
	markConnectAttempted(): void;
	/** Mark a successful stdio transport connection. */
	markConnectSucceeded(): void;
	/** Mark the HTTP listener as successfully started. */
	markListening(): void;
	/** Register a partially acquired target so startup failure can close it. */
	adoptTarget(target: NodeLifecycleTarget): NodeLifecycleTarget;
}

export interface NodeLifecycleTarget {
	close(): Promise<void>;
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
	target: NodeLifecycleTarget;
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

export interface NodeLifecycleHandle {
	close(): Promise<void>;
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

function asError(error: Error | string): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * Owns process-wide Node lifecycle concerns while leaving transport state
 * local.
 *
 * This fork ships no runtime telemetry, so the upstream tracing, metric,
 * process-exception-reporting and npm-registry update-check hooks are
 * deliberately absent here. Do not reintroduce them; see the "No Telemetry,
 * No Phone-Home" section of CLAUDE.md. The scoped resource ownership below is
 * upstream's, and is kept: it guarantees partially acquired targets are closed
 * exactly once when startup fails.
 */
export async function runNodeLifecycle({
	transport,
	start,
	onFailure,
}: RunNodeLifecycleOptions): Promise<NodeLifecycleHandle> {
	const processScope = await Effect.runPromise(Scope.make());
	const lifecycleController = new AbortController();
	const state = createOutcomeState(transport);
	let processScopeClosePromise: Promise<void> | undefined;
	const closeProcessScope = (): Promise<void> => {
		if (processScopeClosePromise) return processScopeClosePromise;
		processScopeClosePromise = Effect.runPromise(
			Scope.close(processScope, Exit.succeed(undefined)),
		).catch(() => undefined);
		return processScopeClosePromise;
	};

	let resolveReady: (handle: NodeLifecycleHandle) => void = () => undefined;
	let rejectReady: (error?: Error | string | LifecycleFailure) => void = () =>
		undefined;
	const ready = new Promise<NodeLifecycleHandle>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	let resolveCompletion: () => void = () => undefined;
	const completion = new Promise<void>((resolve) => {
		resolveCompletion = resolve;
	});
	let completionReported = false;
	const startupCleanups = new Set<() => Promise<void>>();
	const adoptedTargets = new WeakMap<
		NodeLifecycleTarget,
		NodeLifecycleTarget
	>();
	const adoptTarget = (target: NodeLifecycleTarget): NodeLifecycleTarget => {
		const existing = adoptedTargets.get(target);
		if (existing) return existing;
		let closePromise: Promise<void> | undefined;
		const close = (): Promise<void> => {
			if (closePromise) return closePromise;
			closePromise = Promise.resolve()
				.then(() => target.close())
				.catch((error) => {
					throw error;
				});
			return closePromise;
		};
		startupCleanups.add(close);
		const adopted = { close };
		adoptedTargets.set(target, adopted);
		return adopted;
	};
	const context: NodeLifecycleContext = {
		signal: lifecycleController.signal,
		markConnectAttempted: () => state.markConnectAttempted(),
		markConnectSucceeded: () => state.markConnectSucceeded(),
		markListening: () => state.markListening(),
		adoptTarget,
	};

	const ownerProgram = Effect.gen(function* () {
		yield* Effect.acquireRelease(Effect.succeed(undefined), () =>
			Effect.promise(async () => {
				for (const cleanup of Array.from(startupCleanups).toReversed()) {
					await cleanup().catch(() => undefined);
				}
			}),
		);

		const result = yield* Effect.tryPromise({
			try: () => start(context),
			catch: toLifecycleFailure,
		});
		const target = result.target;
		const ownedTarget = adoptTarget(target);

		const shutdown = yield* Effect.try({
			try: () =>
				installGracefulShutdown({
					target,
					closeTarget: () => ownedTarget.close(),
					cancel: lifecycleController,
					onComplete: async (succeeded) => {
						if (completionReported) return;
						completionReported = true;
						try {
							await result.onShutdown?.(succeeded);
						} finally {
							resolveCompletion();
							await closeProcessScope();
						}
					},
				}),
			catch: toLifecycleFailure,
		});
		if (shutdown) {
			yield* Effect.acquireRelease(Effect.succeed(shutdown), (controller) =>
				Effect.sync(() => controller.cleanup()),
			);
		}

		resolveReady({
			close: shutdown ? () => shutdown.close() : () => target.close(),
		});
		if (!shutdown) resolveCompletion();
		yield* Effect.promise(() => completion);
	});

	const ownerFiber = await Effect.runPromise(
		Effect.forkIn(
			ownerProgram.pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						rejectReady(error);
					}),
				),
			),
			processScope,
			{ startImmediately: true },
		).pipe(Effect.provideService(Scope.Scope, processScope)),
	);
	const ownerCompletion = new Promise<void>((resolve) => {
		ownerFiber.addObserver(() => {
			void closeProcessScope().finally(resolve);
		});
	});

	try {
		await ready;
	} catch (error) {
		const outcome = state.getOutcome();
		const reason = classifyFailure(outcome);
		const projectedError =
			error instanceof LifecycleFailure
				? asError(error.cause)
				: asError(error instanceof Error ? error : String(error));
		onFailure?.(reason, outcome);
		await ownerCompletion;
		throw projectedError;
	}

	return await ready;
}

export type { LifecycleTerminationReason };
