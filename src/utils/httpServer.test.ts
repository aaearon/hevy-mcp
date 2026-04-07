import { describe, expect, it } from "vitest";
import { startHttpServer } from "./httpServer.js";

describe("startHttpServer", () => {
	it("is a function", () => {
		expect(typeof startHttpServer).toBe("function");
	});
});
