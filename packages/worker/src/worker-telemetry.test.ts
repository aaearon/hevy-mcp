import { describe, expect, it } from "vitest";
import { getCloudflareColo } from "./worker-telemetry.js";

describe("Worker telemetry context", () => {
	it("returns only a valid Cloudflare colo from request metadata", () => {
		const request = new Request("https://worker.example/mcp");
		Object.defineProperty(request, "cf", {
			value: { colo: "SFO", clientIp: "198.51.100.10" },
		});
		expect(getCloudflareColo(request)).toBe("SFO");
		expect(JSON.stringify(getCloudflareColo(request))).not.toContain(
			"198.51.100.10",
		);
	});

	it.each([
		undefined,
		{},
		{ colo: "sfo" },
		{ colo: "UNKNOWN" },
		{ colo: "1.2.3" },
		{ colo: "" },
	])("omits a missing or invalid colo: %j", (cf) => {
		const request = new Request("https://worker.example/mcp");
		if (cf !== undefined) Object.defineProperty(request, "cf", { value: cf });
		expect(getCloudflareColo(request)).toBeUndefined();
	});
});
