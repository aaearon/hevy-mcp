import { describe, expect, it } from "vitest";
import {
	escapeHtml,
	renderConsentError,
	renderConsentPage,
	verifyConsentPassword,
} from "./oauth-consent.js";

describe("escapeHtml", () => {
	it("escapes every HTML-significant character", () => {
		expect(escapeHtml(`<script>"a"&'b'</script>`)).toBe(
			"&lt;script&gt;&quot;a&quot;&amp;&#x27;b&#x27;&lt;/script&gt;",
		);
	});
});

describe("verifyConsentPassword", () => {
	it("fails closed when MCP_AUTH_PASSWORD is unset or empty", () => {
		expect(verifyConsentPassword("", undefined)).toBe(false);
		expect(verifyConsentPassword("", "")).toBe(false);
		expect(verifyConsentPassword("anything", "")).toBe(false);
		expect(verifyConsentPassword("anything", undefined)).toBe(false);
	});

	it("accepts only an exact match", () => {
		expect(verifyConsentPassword("hunter2", "hunter2")).toBe(true);
		expect(verifyConsentPassword("hunter", "hunter2")).toBe(false);
		expect(verifyConsentPassword("hunter22", "hunter2")).toBe(false);
		expect(verifyConsentPassword("HUNTER2", "hunter2")).toBe(false);
	});
});

describe("renderConsentPage", () => {
	it("escapes the client name, session id and error message", () => {
		const html = renderConsentPage({
			sessionId: `"><script>alert(1)</script>`,
			clientName: `<img src=x onerror=alert(2)>`,
			error: `bad & <wrong>`,
		});

		expect(html).not.toContain("<script>alert(1)");
		expect(html).not.toContain("<img src=x");
		expect(html).not.toContain("<wrong>");
		expect(html).toContain("&lt;script&gt;alert(1)");
		expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
		expect(html).toContain("bad &amp; &lt;wrong&gt;");
	});

	it("omits the error banner when there is no error", () => {
		const html = renderConsentPage({ sessionId: "abc", clientName: "Claude" });
		expect(html).not.toContain('class="error"');
		expect(html).toContain('name="password"');
		expect(html).toContain('action="/consent"');
	});

	it("never echoes a password value back into the form", () => {
		const html = renderConsentPage({
			sessionId: "abc",
			clientName: "Claude",
			error: "Incorrect password.",
		});
		expect(html).toContain('type="password"');
		expect(html).not.toMatch(/name="password"[^>]*value=/u);
	});
});

describe("renderConsentError", () => {
	it("escapes the message", () => {
		expect(renderConsentError("<b>nope</b>")).toContain(
			"&lt;b&gt;nope&lt;/b&gt;",
		);
	});
});
