import { PassThrough, Writable } from "node:stream";
import * as ServerPackage from "@modelcontextprotocol/server";
import type { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deserializeMessageLine,
	createHardenedStdioTransport,
} from "./stdio-parsing.js";

const testDoubles = vi.hoisted(() => ({
	recordSessionStart: vi.fn(() => ({
		name: "test-client",
		version: "1.0.0",
		protocolVersion: "2025-11-25",
	})),
}));

const sdkSharedTestDoubles = vi.hoisted(() => ({
	deserializeMessage: vi.fn(),
}));

vi.mock("@modelcontextprotocol/server", async () => {
	const actual = await vi.importActual<typeof ServerPackage>(
		"@modelcontextprotocol/server",
	);

	sdkSharedTestDoubles.deserializeMessage.mockImplementation(
		actual.deserializeMessage,
	);

	return {
		...actual,
		deserializeMessage: sdkSharedTestDoubles.deserializeMessage,
	};
});

vi.mock("./mcp-session-observability.js", () => ({
	recordMcpSessionStart: testDoubles.recordSessionStart,
}));

interface ReadBufferDouble {
	_buffer?: Buffer;
	readMessage: () => unknown;
}

function createTransportDouble() {
	const readBuffer: ReadBufferDouble = {
		_buffer: undefined,
		readMessage: () => null,
	};
	const originalOnData = vi.fn((chunk: Buffer) => {
		readBuffer._buffer = readBuffer._buffer
			? Buffer.concat([readBuffer._buffer, chunk])
			: chunk;
	});

	return {
		readBuffer,
		originalOnData,
		transport: {
			_readBuffer: readBuffer,
			_ondata: originalOnData,
		},
	};
}

function asStdioTransport(
	transport: ReturnType<typeof createTransportDouble>["transport"],
): StdioServerTransport {
	return z
		.custom<StdioServerTransport>(
			(value) => z.object({}).passthrough().safeParse(value).success,
		)
		.parse(transport);
}

function extractStructuralPreview(diagnostic: string): string {
	const prefix = ' shape_preview="';
	const suffix = '" shape_preview_redacted=';
	const start = diagnostic.indexOf(prefix);
	const end = diagnostic.indexOf(suffix, start + prefix.length);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThanOrEqual(start + prefix.length);

	return diagnostic.slice(start + prefix.length, end);
}

describe("package-local stdio parse hardening", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("parses a BOM-prefixed MCP message", () => {
		const message = deserializeMessageLine(
			'﻿{"jsonrpc":"2.0","id":1,"method":"ping"}',
		);

		expect(message).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			method: "ping",
		});
	});

	it("starts a session context on initialize", () => {
		deserializeMessageLine(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					clientInfo: { name: "test-client", version: "1.2.3" },
				},
			}),
		);

		expect(testDoubles.recordSessionStart).toHaveBeenCalledOnce();
	});

	it("does not start a session context for non-initialize messages", () => {
		deserializeMessageLine('{"jsonrpc":"2.0","id":1,"method":"ping"}');

		expect(testDoubles.recordSessionStart).not.toHaveBeenCalled();
	});

	it("rethrows the parser error for malformed input", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() =>
			deserializeMessageLine('{"jsonrpc":"2.0","method":"tools/call",'),
		).toThrow();
	});

	it.each([
		'{"api_key":"credential-sentinel"',
		"{Authorization: Bearer bearer-sentinel",
		'{"private-workout-field":"private-workout-sentinel"',
	])("redacts malformed content from stderr: %s", (line) => {
		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => deserializeMessageLine(line)).toThrow();

		const diagnostic = String(stderrSpy.mock.calls[0]?.[0]);
		const structuralPreview = extractStructuralPreview(diagnostic);
		expect(diagnostic).toContain("shape_preview_redacted=true");
		expect(diagnostic).not.toContain("credential-sentinel");
		expect(diagnostic).not.toContain("bearer-sentinel");
		expect(diagnostic).not.toContain("private-workout-sentinel");
		expect(structuralPreview.length).toBeLessThanOrEqual(200);
	});

	it("keeps the SDK-internal transport adapter package-local", () => {
		const transport = {} as Parameters<typeof createHardenedStdioTransport>[0];
		expect(createHardenedStdioTransport(transport)).toBe(transport);
	});

	it("preserves buffering across chunks", () => {
		const { originalOnData, readBuffer, transport } = createTransportDouble();
		createHardenedStdioTransport(asStdioTransport(transport));
		const firstChunk = Buffer.from('﻿{"jsonrpc":"2.0","id":1,', "utf8");
		const secondChunk = Buffer.from('"method":"ping"}\r\n', "utf8");

		transport._ondata(firstChunk);
		expect(readBuffer.readMessage()).toBeNull();
		transport._ondata(secondChunk);

		expect(originalOnData).toHaveBeenNthCalledWith(1, firstChunk);
		expect(originalOnData).toHaveBeenNthCalledWith(2, secondChunk);
		expect(readBuffer.readMessage()).toMatchObject({ id: 1, method: "ping" });
	});

	it("parses multiple messages buffered in one chunk", () => {
		const { readBuffer, transport } = createTransportDouble();
		createHardenedStdioTransport(asStdioTransport(transport));
		transport._ondata(
			Buffer.from(
				'{"jsonrpc":"2.0","id":1,"method":"ping"}\n' +
					'{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
				"utf8",
			),
		);

		expect(readBuffer.readMessage()).toMatchObject({ id: 1 });
		expect(readBuffer.readMessage()).toMatchObject({ id: 2 });
		expect(readBuffer.readMessage()).toBeNull();
	});

	it("continues after malformed input with the real SDK transport", async () => {
		const stdin = new PassThrough();
		const stdout = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
		});
		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const transport = createHardenedStdioTransport(
			new (
				await import("@modelcontextprotocol/server/stdio")
			).StdioServerTransport(stdin, stdout),
		);
		let resolveProcessed!: () => void;
		const processed = new Promise<void>((resolve) => {
			resolveProcessed = resolve;
		});
		const onMessage = vi.fn(() => resolveProcessed());
		const onError = vi.fn();
		transport.onmessage = onMessage;
		transport.onerror = onError;

		try {
			await transport.start();
			stdin.write(
				'{malformed}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
			);
			await processed;

			expect(onError).not.toHaveBeenCalled();
			expect(onMessage).toHaveBeenCalledWith({
				jsonrpc: "2.0",
				method: "notifications/initialized",
			});
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to parse MCP stdin message"),
			);
		} finally {
			await transport.close();
			stdin.destroy();
			stdout.destroy();
		}
	});

	it("rethrows unexpected parser failures from the transport adapter", () => {
		const { readBuffer, transport } = createTransportDouble();
		const unexpected = new Error("instrumentation failure");
		unexpected.name = "ZodError";
		sdkSharedTestDoubles.deserializeMessage.mockImplementationOnce(() => {
			throw unexpected;
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		createHardenedStdioTransport(asStdioTransport(transport));
		transport._ondata?.(Buffer.from('{"jsonrpc":"2.0"}\n', "utf8"));

		expect(() => readBuffer.readMessage()).toThrow(unexpected);
	});

	it("defers the message after the malformed-line drain cap", async () => {
		const { readBuffer, transport } = createTransportDouble();
		vi.spyOn(console, "error").mockImplementation(() => {});
		createHardenedStdioTransport(asStdioTransport(transport));
		const malformedLines = Array.from({ length: 100 }, () => "{bad}").join(
			"\n",
		);
		transport._ondata?.(
			Buffer.from(
				`${malformedLines}\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n`,
				"utf8",
			),
		);

		expect(readBuffer.readMessage()).toBeNull();
		await new Promise((resolve) => setImmediate(resolve));
		expect(readBuffer.readMessage()).toMatchObject({ id: 1, method: "ping" });
	});

	it("rethrows the original parser error when diagnostics fail", () => {
		const parserError = new Error("private parser failure at position 3");
		sdkSharedTestDoubles.deserializeMessage.mockImplementationOnce(() => {
			throw parserError;
		});
		vi.spyOn(console, "error").mockImplementation(() => {
			throw new Error("stderr unavailable");
		});

		expect(() => deserializeMessageLine("bad")).toThrow(parserError);
	});
});
