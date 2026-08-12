import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

// Every workspace package is scanned, not just `packages/node`, so a
// reintroduction in `core`, `worker`, `hevy-client` or `cli` is caught too.
// `scripts/` is deliberately excluded: the package-boundary guards there name
// `@sentry/` and `@opentelemetry/` as forbidden strings by design.
// Enumerated from disk rather than hard-coded so a workspace added by a future
// upstream merge is scanned automatically instead of silently skipped.
const PACKAGE_NAMES = readdirSync(join(REPO_ROOT, "packages"))
	.filter((name) => existsSync(join(REPO_ROOT, "packages", name, "src")))
	.sort();

const SOURCE_FILES = PACKAGE_NAMES.flatMap((name) =>
	collectFiles(join(REPO_ROOT, "packages", name, "src"), [".ts"]),
);

const PACKAGE_MANIFESTS = PACKAGE_NAMES.map((name) =>
	join(REPO_ROOT, "packages", name, "package.json"),
);

describe("shipped server carries no runtime telemetry", () => {
	it("finds workspace sources to scan", () => {
		expect(SOURCE_FILES.length).toBeGreaterThan(10);
		// A renamed or relocated workspace must fail loudly rather than quietly
		// shrink the scanned surface.
		expect(PACKAGE_NAMES).toEqual(
			expect.arrayContaining([
				"cli",
				"core",
				"hevy-client",
				"node",
				"operations",
				"worker",
			]),
		);
		for (const name of PACKAGE_NAMES) {
			expect(
				SOURCE_FILES.some((file) =>
					file.startsWith(join(REPO_ROOT, "packages", name, "src")),
				),
			).toBe(true);
		}
	});

	// Covers `from "@sentry/node"`, bare side-effect `import "@sentry/node"`,
	// dynamic `import("@sentry/node")`, and `require("@sentry/node")` /
	// `createRequire(...)("@sentry/node")`. The repo already uses
	// `createRequire` for `better-sqlite3`, so that pattern is live here.
	it("references no @sentry/* or @opentelemetry/* package", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			/(?:from|import|require)\s*\(?\s*["'`](@sentry\/|@opentelemetry\/)/.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});

	it("names no telemetry SDK anywhere in workspace sources", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			/@sentry\/|@opentelemetry\//.test(readFileSync(file, "utf8")),
		);

		expect(offenders).toEqual([]);
	});

	it("declares no telemetry SDK dependency in any workspace package", () => {
		const offenders = PACKAGE_MANIFESTS.flatMap((manifest) => {
			const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<
				string,
				Record<string, string> | undefined
			>;

			const declared = [
				...Object.keys(pkg.dependencies ?? {}),
				...Object.keys(pkg.devDependencies ?? {}),
				...Object.keys(pkg.peerDependencies ?? {}),
			];

			return declared
				.filter((name) => /^@(sentry|opentelemetry)\//.test(name))
				.map((name) => `${manifest}: ${name}`);
		});

		expect(offenders).toEqual([]);
	});

	it("hard-codes no Sentry or OTLP network destination", () => {
		const offenders = SOURCE_FILES.filter((file) => {
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
		const offenders = SOURCE_FILES.filter((file) =>
			/\b(SENTRY_[A-Z_]+|OTEL_[A-Z_]+|HEVY_MCP_TELEMETRY|__OTEL_COLLECTOR_TOKEN__)\b/.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});
});

describe("shipped server phones home to nothing but the Hevy API", () => {
	it("contacts no npm registry", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			/registry\.npmjs\.org/i.test(readFileSync(file, "utf8")),
		);

		expect(offenders).toEqual([]);
	});

	// The Worker observer keeps an inert `userHash` option so upstream merges
	// stay cheap, but nothing in this fork derives that value from the caller's
	// Hevy API key. Guard the derivation, not the seam.
	it("derives no pseudonymous user identity from the API key", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			// No leading `\b`: `createHmac` from `node:crypto` is the likeliest
			// reintroduction and has no word boundary before `Hmac`.
			/(createWorkerUserHash|createUserHash|hmac)/i.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});

	it("schedules no background update check", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			/\b(scheduleUpdateCheck|checkForUpdate)\b/.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});
});
