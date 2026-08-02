import { ZodError } from "zod";
import { deserializeMessage } from "@modelcontextprotocol/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import type { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { recordMcpSessionStart } from "./mcp-session-observability.js";

const UTF8_BOM = "﻿";
/** Maximum escaped characters included in a malformed stdin shape preview. */
const STDIN_PARSE_SHAPE_PREVIEW_MAX_LENGTH = 200;
const REDACTED_CONTENT_MARKER = "[REDACTED]";

const MAX_MALFORMED_LINES_PER_READ = 100;

function isMalformedMessageError(error: unknown): boolean {
	return error instanceof SyntaxError || error instanceof ZodError;
}

interface MutableReadBuffer {
	_buffer?: Buffer;
	readMessage: () => JSONRPCMessage | null;
}

type MutableStdioServerTransport = {
	_readBuffer?: MutableReadBuffer;
};

interface SdkPrivateStdioAdapter {
	installReadMessageHook: (
		onReadLine: (line: string) => JSONRPCMessage,
	) => boolean;
}

/**
 * Adapter boundary around MCP SDK stdio internals.
 *
 * The MCP SDK exposes public message-level hooks but does not expose a public
 * way to skip a malformed stdin line without tearing down the connection. To
 * recover from malformed input, we rely on private internals (`_readBuffer`,
 * `_buffer`) in this one place.
 *
 * If those internals change in a future SDK release, this adapter fails closed
 * and preserves default transport behavior (no parse-hardening patching).
 */
function createSdkPrivateStdioAdapter(
	transport: StdioServerTransport,
): SdkPrivateStdioAdapter {
	const mutableTransport = transport as unknown as MutableStdioServerTransport;

	return {
		installReadMessageHook(onReadLine) {
			const readBuffer = mutableTransport._readBuffer;
			if (!readBuffer || typeof readBuffer.readMessage !== "function") {
				return false;
			}
			let deferredMessage: JSONRPCMessage | null = null;

			readBuffer.readMessage = () => {
				if (deferredMessage) {
					const message = deferredMessage;
					deferredMessage = null;
					return message;
				}
				let skippedMalformedLines = 0;
				while (true) {
					const buffer = readBuffer._buffer;
					if (!buffer) {
						return null;
					}

					const index = buffer.indexOf("\n");
					if (index === -1) {
						return null;
					}

					const lineBuffer = buffer.subarray(0, index);
					readBuffer._buffer = buffer.subarray(index + 1);
					const line = lineBuffer.toString("utf8").replace(/\r$/, "");
					try {
						return onReadLine(line);
					} catch (error) {
						if (!isMalformedMessageError(error)) {
							throw error;
						}
						skippedMalformedLines += 1;
						if (skippedMalformedLines >= MAX_MALFORMED_LINES_PER_READ) {
							setImmediate(() => {
								const message = readBuffer.readMessage();
								if (message) deferredMessage = message;
							});
							return null;
						}
					}
				}
			};
			return true;
		},
	};
}

function parseFailurePosition(error: unknown): number | null {
	if (!(error instanceof Error)) {
		return null;
	}

	const match = error.message.match(/position\s+(\d+)/i);
	if (!match || !match[1]) {
		return null;
	}

	const position = Number.parseInt(match[1], 10);
	return Number.isFinite(position) ? position : null;
}

function getFailureLocation(
	failurePosition: number | null,
	lineHadLeadingBom: boolean,
): string {
	if (lineHadLeadingBom) {
		return "line_start_bom";
	}
	if (failurePosition === 0) {
		return "line_start";
	}
	if (failurePosition !== null) {
		return "line_body";
	}
	return "unknown";
}

function createStructuralShapePreview(line: string): {
	shapePreview: string;
	truncated: boolean;
} {
	let shapePreview = "";
	let inContentRun = false;
	let inWhitespaceRun = false;

	const append = (token: string): boolean => {
		if (
			shapePreview.length + token.length >
			STDIN_PARSE_SHAPE_PREVIEW_MAX_LENGTH
		) {
			return false;
		}

		shapePreview += token;
		return true;
	};

	for (const character of line) {
		if ('{}[]:,"'.includes(character)) {
			inContentRun = false;
			inWhitespaceRun = false;
			if (!append(character === '"' ? "\\u0022" : character)) {
				return { shapePreview, truncated: true };
			}
			continue;
		}

		if (/\s/u.test(character)) {
			inContentRun = false;
			if (!inWhitespaceRun) {
				if (!append("\\s")) {
					return { shapePreview, truncated: true };
				}
				inWhitespaceRun = true;
			}
			continue;
		}

		inWhitespaceRun = false;
		if (!inContentRun) {
			if (!append(REDACTED_CONTENT_MARKER)) {
				return { shapePreview, truncated: true };
			}
			inContentRun = true;
		}
	}

	return {
		shapePreview,
		truncated: false,
	};
}

function getSafeErrorKind(
	error: unknown,
): "SyntaxError" | "Error" | "UnknownError" {
	if (error instanceof SyntaxError) {
		return "SyntaxError";
	}
	if (error instanceof Error) {
		return "Error";
	}
	return "UnknownError";
}

function reportStdinParseFailure(
	error: unknown,
	line: string,
	lineByteLength: number,
	failureLocation: string,
	failurePosition: number | null,
): void {
	try {
		const errorKind = getSafeErrorKind(error);
		const { shapePreview, truncated } = createStructuralShapePreview(line);
		const position = failurePosition === null ? "unknown" : failurePosition;

		console.error(
			`Failed to parse MCP stdin message: error_kind=${errorKind} line_bytes=${lineByteLength} failure_location=${failureLocation} failure_position=${position} shape_preview="${shapePreview}" shape_preview_redacted=true shape_preview_truncated=${truncated}`,
		);
	} catch {
		// Diagnostics are best-effort and must not replace the parser error.
	}
}

/**
 * Parses a single stdin line into an MCP message.
 *
 * Strips a leading UTF-8 BOM (some Windows clients emit one) and, on failure,
 * logs a redacted structural diagnostic to stderr before rethrowing the
 * original parser error unchanged.
 */
export function deserializeMessageLine(line: string): JSONRPCMessage {
	const lineHadLeadingBom = line.startsWith(UTF8_BOM);
	const normalizedLine = lineHadLeadingBom ? line.slice(1) : line;
	const lineByteLength = Buffer.byteLength(line);

	try {
		const message = deserializeMessage(normalizedLine);
		if (
			message &&
			typeof message === "object" &&
			"method" in message &&
			message.method === "initialize"
		) {
			recordMcpSessionStart(message);
		}
		return message;
	} catch (error) {
		const failurePosition = parseFailurePosition(error);
		const failureLocation = getFailureLocation(
			failurePosition,
			lineHadLeadingBom,
		);

		reportStdinParseFailure(
			error,
			line,
			lineByteLength,
			failureLocation,
			failurePosition,
		);

		throw error;
	}
}

/**
 * Hardens a stdio transport against malformed stdin lines: BOM-prefixed
 * messages are accepted and unparsable lines are skipped (up to a per-read
 * cap) instead of killing the connection.
 */
export function createHardenedStdioTransport<T extends StdioServerTransport>(
	transport: T,
): T {
	createSdkPrivateStdioAdapter(transport).installReadMessageHook(
		deserializeMessageLine,
	);
	return transport;
}
