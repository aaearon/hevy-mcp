import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMcpSessionContext,
	extractMcpClientMetadata,
	getCurrentMcpClientMetadata,
	getCurrentMcpSessionId,
	getCurrentMcpTransport,
	recordMcpSessionStart,
	recordMcpSessionTermination,
	recordMcpToolFailure,
	recordMcpToolInvocation,
	resolveSessionTerminationCategory,
	runWithMcpSessionContext,
} from "./mcp-session-observability.js";

describe("MCP session context", () => {
	beforeEach(() => {
		recordMcpSessionTermination("unknown");
		vi.clearAllMocks();
	});

	it("tracks tool failures on the active stdio session", () => {
		recordMcpSessionStart({
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				clientInfo: { name: "Claude-Desktop", version: "1.2.3" },
			},
		});

		recordMcpToolInvocation();
		recordMcpToolFailure();

		expect(resolveSessionTerminationCategory(true)).toBe("tool_failure");
	});

	it("reports a clean termination when no tool failed", () => {
		recordMcpSessionStart({ method: "initialize" });

		expect(resolveSessionTerminationCategory(true)).toBe("clean");
		expect(resolveSessionTerminationCategory(false)).toBe("unknown");
	});

	it("clears the active stdio session on termination", () => {
		recordMcpSessionStart({
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				clientInfo: { name: "Claude-Desktop", version: "1.2.3" },
			},
		});
		expect(getCurrentMcpClientMetadata().name).toBe("Claude-Desktop");

		recordMcpSessionTermination("clean");

		expect(getCurrentMcpClientMetadata().name).toBe("unknown");
		expect(getCurrentMcpTransport()).toBe("stdio");
	});

	it("returns sanitized client metadata from initialize", () => {
		expect(
			extractMcpClientMetadata({
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					clientInfo: { name: "a".repeat(65), version: "1.2.3" },
				},
			}),
		).toEqual({
			name: "unknown",
			version: "1.2.3",
			protocolVersion: "2025-11-25",
		});
	});

	it("isolates opaque IDs across sessions and propagates the active ID", () => {
		const first = createMcpSessionContext({ method: "initialize" }, "http", {
			telemetrySessionId: "session-one",
		});
		const second = createMcpSessionContext({ method: "initialize" }, "http", {
			telemetrySessionId: "session-two",
		});

		expect(first.telemetrySessionId).not.toBe(second.telemetrySessionId);
		expect(
			runWithMcpSessionContext(first, () => getCurrentMcpSessionId()),
		).toBe("session-one");
		expect(
			runWithMcpSessionContext(second, () => getCurrentMcpSessionId()),
		).toBe("session-two");
	});

	it("keeps an HTTP session scoped to its own async context", () => {
		const context = createMcpSessionContext({ method: "initialize" }, "http", {
			telemetrySessionId: "session-http",
		});

		runWithMcpSessionContext(context, () => {
			recordMcpSessionStart({}, "http", context);
			expect(getCurrentMcpTransport()).toBe("http");
		});

		// HTTP sessions never become the process-wide stdio fallback.
		expect(getCurrentMcpSessionId()).toBeUndefined();
	});

	it("generates one injectable opaque ID per session", () => {
		const generate = vi.fn(() => "generated-session");
		const context = createMcpSessionContext({ method: "initialize" }, "stdio", {
			generateTelemetrySessionId: generate,
		});

		expect(context.telemetrySessionId).toBe("generated-session");
		expect(generate).toHaveBeenCalledOnce();
	});
});
