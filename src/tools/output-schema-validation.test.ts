import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HevyClient } from "../utils/hevyClient.js";
import { registerBodyMeasurementTools } from "./body-measurements.js";
import { registerFolderTools } from "./folders.js";
import { registerRoutineTools } from "./routines.js";
import { registerTemplateTools } from "./templates.js";
import { registerUserTools } from "./user.js";
import { registerWebhookTools } from "./webhooks.js";
import { registerWorkoutTools } from "./workouts.js";

/**
 * Cross-tool guard: the MCP SDK validates each tool's structuredContent against
 * its declared outputSchema at runtime (server.mcp.js -> validateToolOutput).
 * The per-tool unit tests call handlers directly and never exercise that path,
 * so this suite captures every registered outputSchema, drives each tool's
 * success path with a permissive mock client, and asserts the returned
 * structuredContent parses against the declared schema — exactly what a real
 * MCP client would enforce.
 */

type ToolResponse = {
	content: Array<{ type: string; text: string }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

type Registration = {
	name: string;
	outputSchema?: Record<string, z.ZodTypeAny>;
	handler: (args: Record<string, unknown>) => Promise<ToolResponse>;
};

function captureRegistrations(
	register: (server: McpServer, client: HevyClient | null) => void,
	client: HevyClient,
): Registration[] {
	const regs: Registration[] = [];
	const server = {
		tool: () => {},
		registerTool: (
			name: string,
			config: { outputSchema?: Record<string, z.ZodTypeAny> },
			handler: Registration["handler"],
		) => {
			regs.push({ name, outputSchema: config.outputSchema, handler });
		},
	} as unknown as McpServer;
	register(server, client);
	return regs;
}

// A truthy, permissive API response: list keys yield arrays, the rest yield
// usable scalars, so every tool's success branch runs and produces
// structuredContent we can validate. Formatters tolerate the missing fields.
const sampleResponse = {
	workouts: [{}],
	routines: [{}],
	// single-item getters read a singular key off the response
	routine: {},
	// title must match the search query ("bench") so search returns results
	exercise_templates: [{ title: "Bench Press" }],
	routine_folders: [{}],
	events: [{}],
	exercises: [],
	sets: [],
	workout_count: 3,
	page_count: 1,
	data: { username: "tester", id: "user-1" },
	// `id` is intentionally omitted: it is a string for workouts/routines but a
	// number for routine folders, so a single shared value cannot satisfy every
	// schema. Left undefined (valid-optional everywhere); formatter<->schema
	// type agreement is already enforced at compile time via z.infer.
	title: "Sample",
	date: "2025-01-01",
};

function createMockClient(): HevyClient {
	return new Proxy(
		{},
		{
			get: () => () => Promise.resolve(sampleResponse),
		},
	) as unknown as HevyClient;
}

// Generic happy-path args; extra fields are ignored by handlers that don't use
// them. Required arrays default to empty so mapping logic runs without throwing.
const defaultArgs: Record<string, unknown> = {
	page: 1,
	pageSize: 5,
	since: "2025-01-01T00:00:00Z",
	workoutId: "sample-id",
	routineId: "sample-id",
	folderId: "sample-id",
	exerciseTemplateId: "sample-id",
	title: "Sample",
	query: "bench",
	startTime: "2025-01-01T00:00:00Z",
	endTime: "2025-01-01T01:00:00Z",
	isPrivate: false,
	exercises: [],
};

const registrars = [
	registerWorkoutTools,
	registerRoutineTools,
	registerTemplateTools,
	registerFolderTools,
	registerBodyMeasurementTools,
	registerUserTools,
	registerWebhookTools,
];

describe("tool outputSchema matches returned structuredContent", () => {
	const registrations = registrars.flatMap((register) =>
		captureRegistrations(register, createMockClient()),
	);

	const schemaTools = registrations.filter((reg) => reg.outputSchema);

	it("registers at least one tool with an output schema", () => {
		expect(schemaTools.length).toBeGreaterThan(0);
	});

	for (const reg of schemaTools) {
		it(`${reg.name}: structuredContent validates against its outputSchema`, async () => {
			const response = await reg.handler({ ...defaultArgs });

			// A tool that declares an outputSchema must drive a real success path
			// here; an error response means the mock failed to exercise it.
			expect(
				response.isError,
				`${reg.name} returned an error: ${response.content?.[0]?.text}`,
			).not.toBe(true);

			expect(response.structuredContent).toBeDefined();

			const schema = z.object(reg.outputSchema as Record<string, z.ZodTypeAny>);
			const result = schema.safeParse(response.structuredContent);
			expect(
				result.success,
				`${reg.name} structuredContent failed schema: ${
					result.success ? "" : JSON.stringify(result.error.issues, null, 2)
				}`,
			).toBe(true);
		});
	}
});
