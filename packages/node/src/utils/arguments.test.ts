import { describe, expect, it } from "vitest";
import { parseNodeCliOptions } from "./arguments.js";

describe("parseNodeCliOptions", () => {
	it("defaults to stdio without binding HTTP", () => {
		expect(parseNodeCliOptions([])).toEqual({
			transport: "stdio",
			host: "127.0.0.1",
			port: 3000,
		});
	});

	it("keeps explicit stdio on the stdio defaults", () => {
		expect(parseNodeCliOptions(["--transport", "stdio"])).toEqual({
			transport: "stdio",
			host: "127.0.0.1",
			port: 3000,
		});
	});

	it("parses HTTP options", () => {
		expect(
			parseNodeCliOptions([
				"--transport",
				"http",
				"--host",
				"localhost",
				"--port",
				"8080",
			]),
		).toEqual({ transport: "http", host: "localhost", port: 8080 });
	});

	it("rejects invalid transport and unknown options", () => {
		for (const argv of [["--transport", "wat"], ["--unknown"]]) {
			expect(() => parseNodeCliOptions(argv)).toThrow();
		}
	});

	it("rejects HTTP-only options in stdio mode", () => {
		expect(() => parseNodeCliOptions(["--port", "3001"])).toThrow(
			"only be used with --transport http",
		);
	});

	it("rejects invalid ports", () => {
		expect(() =>
			parseNodeCliOptions(["--transport", "http", "--port", "65536"]),
		).toThrow("1 to 65535");
	});

	it.each(["bad host", "[127.0.0.1]", "example.com/path", "127.0.0.1:3000"])(
		"rejects invalid host %s",
		(host) => {
			expect(() =>
				parseNodeCliOptions(["--transport", "http", "--host", host]),
			).toThrow("Invalid host");
		},
	);

	it("parses the fork-specific http+oauth transport", () => {
		expect(
			parseNodeCliOptions(
				[
					"--transport=http+oauth",
					"--port=8000",
					"--issuer-url=https://mcp.example.com/",
				],
				{},
			),
		).toEqual({
			transport: "http+oauth",
			host: "127.0.0.1",
			port: 8000,
			issuerUrl: "https://mcp.example.com",
		});
	});

	it("falls back to MCP_ISSUER_URL for http+oauth", () => {
		expect(
			parseNodeCliOptions(["--transport", "http+oauth"], {
				MCP_ISSUER_URL: "https://mcp.example.com",
			}),
		).toMatchObject({
			transport: "http+oauth",
			issuerUrl: "https://mcp.example.com",
		});
	});

	it("requires an issuer URL for http+oauth", () => {
		expect(() =>
			parseNodeCliOptions(["--transport", "http+oauth"], {}),
		).toThrow("requires --issuer-url or MCP_ISSUER_URL");
	});

	it("rejects a malformed issuer URL", () => {
		for (const issuer of ["not-a-url", "ftp://example.com"]) {
			expect(() =>
				parseNodeCliOptions(
					["--transport", "http+oauth", "--issuer-url", issuer],
					{},
				),
			).toThrow("Invalid issuer URL");
		}
	});

	it("accepts bracketed IPv6 input and normalizes it for listen", () => {
		expect(
			parseNodeCliOptions(["--transport", "http", "--host", "[::1]"]),
		).toMatchObject({ host: "::1" });
	});
});
