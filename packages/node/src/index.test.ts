import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testDoubles = vi.hoisted(() => {
	const server = {
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	};
	const startupClient = {
		getUserInfo: vi.fn().mockResolvedValue({ id: "user" }),
	};
	const runtimeClient = { kind: "runtime-client" };
	const httpHandle = { close: vi.fn().mockResolvedValue(undefined) };

	return {
		server,
		startupClient,
		runtimeClient,
		httpHandle,
		transport: { kind: "stdio-transport" },
		createHevyClient: vi.fn(),
		createHevyMcpServer: vi.fn(),
		startStreamableHttpServer: vi.fn(),
		installGracefulShutdown: vi.fn(),
		hardenTransport: vi.fn(() => ({ kind: "stdio-transport" })),
		scheduleUpdateCheck: vi.fn(),
		recordSessionTermination: vi.fn(),
		resolveTerminationCategory: vi.fn(() => "clean"),
		createNodeHevyClientOptions: vi.fn(() => ({
			onRequestComplete: vi.fn(),
		})),
	};
});

vi.mock("./utils/service-info.js", () => ({
	serviceName: "hevy-mcp",
	serviceVersion: "3.4.1",
	serviceInfo: { name: "hevy-mcp", version: "3.4.1" },
}));

vi.mock("@hevy-mcp/hevy-client", () => ({
	createHevyClient: testDoubles.createHevyClient,
	isHevyHttpError: (error: unknown) =>
		Boolean(
			error &&
			typeof error === "object" &&
			"isHevyHttpError" in error &&
			error.isHevyHttpError === true,
		),
}));
vi.mock("@hevy-mcp/core", () => ({
	createHevyMcpServer: testDoubles.createHevyMcpServer,
	createSafeErrorDiagnostic: vi.fn(() => ({ category: "Error" })),
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
	StdioServerTransport: class StdioServerTransport {},
}));

vi.mock("./utils/streamable-http.js", () => ({
	startStreamableHttpServer: testDoubles.startStreamableHttpServer,
}));

vi.mock("./utils/graceful-shutdown.js", () => ({
	installGracefulShutdown: testDoubles.installGracefulShutdown,
}));

vi.mock("./utils/hevy-client-debug.js", () => ({
	createNodeHevyClientOptions: testDoubles.createNodeHevyClientOptions,
}));

vi.mock("./utils/stdio-parsing.js", () => ({
	createHardenedStdioTransport: testDoubles.hardenTransport,
}));

vi.mock("./utils/mcp-session-observability.js", () => ({
	recordMcpSessionTermination: testDoubles.recordSessionTermination,
	resolveSessionTerminationCategory: testDoubles.resolveTerminationCategory,
}));

vi.mock("./utils/version-check.js", () => ({
	scheduleUpdateCheck: testDoubles.scheduleUpdateCheck,
}));

import { createNodeMcpServer, runServer, runStdioServer } from "./index.js";

const originalArgv = [...process.argv];
const originalApiKey = process.env.HEVY_API_KEY;

function configureSuccessfulConstruction(): void {
	testDoubles.createHevyClient.mockImplementation(
		(options: { maxGetRetries?: number }) =>
			options.maxGetRetries === 0
				? testDoubles.startupClient
				: testDoubles.runtimeClient,
	);
	testDoubles.createHevyMcpServer.mockImplementation(
		(options: {
			createClient: (context: { onLog: () => void }) => unknown;
		}) => {
			options.createClient({ onLog: vi.fn() });
			return testDoubles.server;
		},
	);
}

describe("Node package entrypoint", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		testDoubles.server.connect.mockResolvedValue(undefined);
		testDoubles.startupClient.getUserInfo.mockResolvedValue({ id: "user" });
		configureSuccessfulConstruction();
		testDoubles.startStreamableHttpServer.mockResolvedValue(
			testDoubles.httpHandle,
		);
		process.argv = [originalArgv[0] ?? "node", "hevy-mcp"];
		delete process.env.HEVY_API_KEY;
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		process.argv = [...originalArgv];
		if (originalApiKey === undefined) {
			delete process.env.HEVY_API_KEY;
		} else {
			process.env.HEVY_API_KEY = originalApiKey;
		}
		vi.restoreAllMocks();
	});

	it("constructs an unconnected server from explicit options", async () => {
		process.env.HEVY_API_KEY = "environment-key-sentinel";

		await expect(
			createNodeMcpServer({ apiKey: "programmatic-key" }),
		).resolves.toBe(testDoubles.server);

		expect(testDoubles.createHevyClient).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				apiKey: "programmatic-key",
				baseUrl: "https://api.hevyapp.com",
				maxGetRetries: 0,
				timeoutMs: 5_000,
			}),
		);
		expect(testDoubles.createHevyClient).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				apiKey: "programmatic-key",
				onLog: expect.any(Function),
				onRequestComplete: expect.any(Function),
			}),
		);
		expect(testDoubles.server.connect).not.toHaveBeenCalled();
	});

	it("sanitizes HTTP and malformed startup diagnostics", async () => {
		testDoubles.startupClient.getUserInfo.mockRejectedValueOnce({
			response: { status: 503 },
		});
		await expect(createNodeMcpServer({ apiKey: "valid-key" })).resolves.toBe(
			testDoubles.server,
		);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("Diagnostic: HTTP 503"),
		);

		vi.mocked(console.error).mockClear();
		testDoubles.startupClient.getUserInfo.mockRejectedValueOnce({
			response: {},
		});
		await expect(createNodeMcpServer({ apiKey: "valid-key" })).resolves.toBe(
			testDoubles.server,
		);
		expect(console.error).not.toHaveBeenCalledWith(
			expect.stringContaining("Diagnostic: HTTP"),
		);
	});

	it("dispatches the default transport through runServer", async () => {
		process.env.HEVY_API_KEY = "runtime-key";
		await runServer();
		expect(testDoubles.server.connect).toHaveBeenCalledWith(
			testDoubles.transport,
		);
	});

	it("reports missing runtime keys through the lifecycle failure path", async () => {
		await expect(runStdioServer()).rejects.toThrow("Hevy API key is required");
		expect(testDoubles.recordSessionTermination).toHaveBeenCalledWith(
			"startup_failure",
		);
	});

	it.each([401, 403])(
		"rejects a startup probe returning HTTP %s with the stable key message",
		async (status) => {
			testDoubles.startupClient.getUserInfo.mockRejectedValueOnce({
				isHevyHttpError: true,
				status,
			});

			await expect(
				createNodeMcpServer({ apiKey: "invalid-key" }),
			).rejects.toThrow("HEVY_API_KEY is invalid or expired");
			expect(testDoubles.createHevyMcpServer).not.toHaveBeenCalled();
		},
	);

	it("propagates construction failures to the caller", async () => {
		testDoubles.createHevyMcpServer.mockImplementationOnce(() => {
			throw new Error("construction failure");
		});
		await expect(createNodeMcpServer({ apiKey: "valid-key" })).rejects.toThrow(
			"construction failure",
		);
	});

	it("continues after availability failures without logging arbitrary errors", async () => {
		const secret = "network-error-secret-sentinel";
		testDoubles.startupClient.getUserInfo.mockRejectedValueOnce(
			Object.assign(new Error(secret), { code: "ENOTFOUND" }),
		);

		await expect(createNodeMcpServer({ apiKey: "valid-key" })).resolves.toBe(
			testDoubles.server,
		);

		const stderr = JSON.stringify(vi.mocked(console.error).mock.calls);
		expect(stderr).toContain("Diagnostic: ENOTFOUND");
		expect(stderr).not.toContain(secret);
	});

	it.each([
		{ flag: "--help", output: "Usage:" },
		{ flag: "-h", output: "Usage:" },
	])("prints help for $flag without starting", async ({ flag, output }) => {
		process.argv.push(flag);

		await runStdioServer();
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining(output));

		expect(testDoubles.createHevyClient).not.toHaveBeenCalled();
	});

	it("does not advertise any telemetry environment variables in help", async () => {
		process.argv.push("--help");

		await runStdioServer();

		const helpText = String(vi.mocked(console.log).mock.calls[0]?.[0]);
		expect(helpText).not.toMatch(/telemetry|sentry|otel/i);
	});

	it.each([
		["--help", "--transport", "http"],
		["--version", "--transport", "http"],
	])(
		"prioritizes %s over transport dispatch",
		async (flag, transportFlag, transport) => {
			process.argv.push(flag, transportFlag, transport);
			await runServer();
			expect(testDoubles.createHevyClient).not.toHaveBeenCalled();
		},
	);

	it.each(["--version", "-v"])(
		"prints the package version for %s without starting",
		async (flag) => {
			process.argv.push(flag);

			await runStdioServer();

			expect(console.error).toHaveBeenCalledWith("hevy-mcp v3.4.1");
			expect(testDoubles.createHevyClient).not.toHaveBeenCalled();
		},
	);

	it("validates the HTTP key once and builds sessions without re-probing", async () => {
		process.env.HEVY_API_KEY = "runtime-key";
		process.argv.push("--transport", "http");
		testDoubles.startStreamableHttpServer.mockImplementationOnce(
			async (
				_options: unknown,
				_apiKey: string,
				factory: (params: { apiKey: string }) => Promise<unknown>,
			) => {
				await factory({ apiKey: "runtime-key" });
				return testDoubles.httpHandle;
			},
		);

		await runServer();

		expect(testDoubles.startupClient.getUserInfo).toHaveBeenCalledOnce();
		expect(testDoubles.createHevyMcpServer).toHaveBeenCalledOnce();
		expect(testDoubles.installGracefulShutdown).toHaveBeenCalledWith(
			expect.objectContaining({ target: testDoubles.httpHandle }),
		);
	});

	it("fails HTTP startup when the key is rejected", async () => {
		process.env.HEVY_API_KEY = "invalid-key";
		process.argv.push("--transport", "http");
		testDoubles.startupClient.getUserInfo.mockRejectedValueOnce({
			isHevyHttpError: true,
			status: 401,
		});

		await expect(runServer()).rejects.toThrow(
			"HEVY_API_KEY is invalid or expired",
		);
		expect(testDoubles.startStreamableHttpServer).not.toHaveBeenCalled();
		expect(testDoubles.recordSessionTermination).toHaveBeenCalledWith(
			"startup_failure",
		);
	});

	it("connects stdio and installs lifecycle ownership", async () => {
		process.env.HEVY_API_KEY = "runtime-key";

		await runStdioServer();

		expect(testDoubles.hardenTransport).toHaveBeenCalledOnce();
		expect(testDoubles.server.connect).toHaveBeenCalledWith(
			testDoubles.transport,
		);
		expect(testDoubles.scheduleUpdateCheck).toHaveBeenCalledWith({
			packageName: "hevy-mcp",
			currentVersion: "3.4.1",
		});
		expect(testDoubles.installGracefulShutdown).toHaveBeenCalledWith(
			expect.objectContaining({
				target: testDoubles.server,
				onComplete: expect.any(Function),
			}),
		);
	});

	it("classifies a stdio connection failure", async () => {
		process.env.HEVY_API_KEY = "runtime-key";
		testDoubles.server.connect.mockRejectedValueOnce(
			new Error("connect failure"),
		);

		await expect(runStdioServer()).rejects.toThrow("connect failure");

		expect(testDoubles.recordSessionTermination).toHaveBeenCalledWith(
			"connect_failure",
		);
		expect(testDoubles.installGracefulShutdown).not.toHaveBeenCalled();
	});

	it("reports graceful completion through the session lifecycle", async () => {
		process.env.HEVY_API_KEY = "runtime-key";
		await runStdioServer();
		const options = testDoubles.installGracefulShutdown.mock.calls[0]?.[0] as {
			onComplete: (succeeded: boolean) => void;
		};

		options.onComplete(true);

		expect(testDoubles.resolveTerminationCategory).toHaveBeenCalledWith(true);
		expect(testDoubles.recordSessionTermination).toHaveBeenCalledWith("clean");
	});
});
