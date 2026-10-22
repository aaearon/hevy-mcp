import { describe, expect, it } from "vitest";

import { TELEMETRY_ARGUMENT_KEYS } from "./telemetry-contract.js";

describe("telemetry contract", () => {
	it("lists unique snake_case argument keys", () => {
		expect(new Set(TELEMETRY_ARGUMENT_KEYS).size).toBe(
			TELEMETRY_ARGUMENT_KEYS.length,
		);
		for (const key of TELEMETRY_ARGUMENT_KEYS) {
			expect(key).toMatch(/^[a-z_]+$/);
		}
	});
});
