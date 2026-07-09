import { afterEach, describe, expect, it, vi } from "vitest";
import { assertIssuerUrl, parseConfig } from "./config.js";

function env(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
	return { ...process.env, ...vars } as NodeJS.ProcessEnv;
}

describe("parseConfig", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		["--hevy-api-key=cliKey", "cliKey"],
		["--hevyApiKey=camelKey", "camelKey"],
		["hevy-api-key=bareKey", "bareKey"],
	])("uses %s and emits a deprecation warning", (cliArg, expectedApiKey) => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const cfg = parseConfig([cliArg], env({ HEVY_API_KEY: "envKey" }));

		expect(cfg.apiKey).toBe(expectedApiKey);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("HEVY_API_KEY"),
		);
		expect(errorSpy.mock.calls[0]?.[0]).toMatch(/deprecated/i);
	});

	it("falls back to env HEVY_API_KEY without deprecation warning", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const cfg = parseConfig([], env({ HEVY_API_KEY: "envOnly" }));

		expect(cfg.apiKey).toBe("envOnly");
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("parses --transport=http", () => {
		const cfg = parseConfig(["--transport=http"], env({}));
		expect(cfg.transport).toBe("http");
	});

	it("parses --transport=stdio", () => {
		const cfg = parseConfig(["--transport=stdio"], env({}));
		expect(cfg.transport).toBe("stdio");
	});

	it("transport defaults to undefined when not provided", () => {
		const cfg = parseConfig([], env({}));
		expect(cfg.transport).toBeUndefined();
	});

	it("parses --port=4000", () => {
		const cfg = parseConfig(["--port=4000"], env({}));
		expect(cfg.port).toBe(4000);
	});

	it("port defaults to undefined when not provided", () => {
		const cfg = parseConfig([], env({}));
		expect(cfg.port).toBeUndefined();
	});

	it("throws on out-of-range port", () => {
		expect(() => parseConfig(["--port=99999"], env({}))).toThrow(
			/Invalid --port value/,
		);
	});

	it("parses --transport=http+oauth", () => {
		const cfg = parseConfig(["--transport=http+oauth"], env({}));
		expect(cfg.transport).toBe("http+oauth");
	});

	it("parses --issuer-url=https://example.com", () => {
		const cfg = parseConfig(["--issuer-url=https://example.com"], env({}));
		expect(cfg.issuerUrl).toBe("https://example.com");
	});

	it("falls back to MCP_ISSUER_URL env var", () => {
		const cfg = parseConfig(
			[],
			env({ MCP_ISSUER_URL: "https://env.example.com" }),
		);
		expect(cfg.issuerUrl).toBe("https://env.example.com");
	});

	it("CLI --issuer-url takes priority over MCP_ISSUER_URL env var", () => {
		const cfg = parseConfig(
			["--issuer-url=https://cli.example.com"],
			env({ MCP_ISSUER_URL: "https://env.example.com" }),
		);
		expect(cfg.issuerUrl).toBe("https://cli.example.com");
	});
});

describe("assertIssuerUrl", () => {
	it("exits if issuer URL is undefined", () => {
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((_code?: string | number | null) => {
				throw new Error("process.exit called");
			});
		expect(() => assertIssuerUrl(undefined)).toThrow("process.exit called");
		exitSpy.mockRestore();
	});

	it("does not throw when issuer URL is provided", () => {
		expect(() => assertIssuerUrl("https://example.com")).not.toThrow();
	});
});
