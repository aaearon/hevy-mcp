import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function collectFiles(dir: string, extensions: string[]): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === "node_modules" || entry === "dist") continue;
			found.push(...collectFiles(full, extensions));
			continue;
		}
		if (extensions.some((extension) => entry.endsWith(extension))) {
			found.push(full);
		}
	}
	return found;
}

const NODE_SOURCE_FILES = collectFiles(join(REPO_ROOT, "packages/node/src"), [
	".ts",
]);

describe("shipped server carries no runtime telemetry", () => {
	it("finds Node package sources to scan", () => {
		expect(NODE_SOURCE_FILES.length).toBeGreaterThan(10);
	});

	it("imports no @sentry/* or @opentelemetry/* package", () => {
		const offenders = NODE_SOURCE_FILES.filter((file) =>
			/from\s+["'](@sentry\/|@opentelemetry\/)/.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});

	it("declares no telemetry SDK dependency in the published package", () => {
		const pkg = JSON.parse(
			readFileSync(join(REPO_ROOT, "packages/node/package.json"), "utf8"),
		) as Record<string, Record<string, string> | undefined>;

		const declared = [
			...Object.keys(pkg.dependencies ?? {}),
			...Object.keys(pkg.devDependencies ?? {}),
			...Object.keys(pkg.peerDependencies ?? {}),
		];

		expect(
			declared.filter((name) => /^@(sentry|opentelemetry)\//.test(name)),
		).toEqual([]);
	});

	it("hard-codes no Sentry or OTLP network destination", () => {
		const offenders = NODE_SOURCE_FILES.filter((file) => {
			const source = readFileSync(file, "utf8");
			return (
				/ingest\.[a-z]*\.?sentry\.io/i.test(source) ||
				/otel\.[a-z0-9-]+\.dev/i.test(source) ||
				/\/v1\/(traces|metrics)\b/.test(source)
			);
		});

		expect(offenders).toEqual([]);
	});

	it("reads no telemetry environment variable", () => {
		const offenders = NODE_SOURCE_FILES.filter((file) =>
			/\b(SENTRY_[A-Z_]+|OTEL_[A-Z_]+|HEVY_MCP_TELEMETRY|__OTEL_COLLECTOR_TOKEN__)\b/.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});
});
