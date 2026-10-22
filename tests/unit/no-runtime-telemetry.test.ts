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

	// Nothing in this fork derives a pseudonymous identity from the caller's
	// Hevy API key: the derivation helpers are gone, and so are upstream's
	// `USER_HASH_*` contract constants, whose only purpose was to build a
	// Sentry user id. Guard the derivation AND the constants that enable it.
	it("derives no pseudonymous user identity from the API key", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			// No leading `\b`: `createHmac` from `node:crypto` is the likeliest
			// reintroduction and has no word boundary before `Hmac`.
			/(createWorkerUserHash|createNodeUserHash|createUserHash|USER_HASH_CONTEXT|USER_HASH_LENGTH|SAFE_USER_HASH_PATTERN|sentry-user-id|hmac)/i.test(
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

// Shipped (non-test) sources only: tests legitimately name fake hosts.
const SHIPPED_SOURCE_FILES = SOURCE_FILES.filter(
	(file) =>
		!file.endsWith(".test.ts") &&
		!file.includes("/generated/") &&
		!file.includes("/test-fixtures/") &&
		!file.endsWith("/test-support.ts"),
);

// Every absolute URL host a shipped source may name. Only api.hevyapp.com is
// ever contacted by the server. The rest are inert strings: CORS/redirect
// origin allowlists (claude.*, chatgpt.com, chat.openai.com, vscode.dev,
// github.dev), a link the user clicks on the consent page (hevy.com), a doc
// link in an error hint (github.com), and the Worker's default OAuth resource
// identifier (mcp.hevy-mcp.dev), which names an audience and is never fetched.
// Anything else (an icon, a collector, an update check) must be argued for
// here before it ships.
const ALLOWED_URL_HOSTS = new Set([
	"api.hevyapp.com",
	"hevy.com",
	"claude.ai",
	"www.claude.ai",
	"claude.com",
	"www.claude.com",
	"chatgpt.com",
	"chat.openai.com",
	"vscode.dev",
	"github.dev",
	"github.com",
	"mcp.hevy-mcp.dev",
	"localhost",
	"127.0.0.1",
]);

const URL_HOST_PATTERN = /https?:\/\/([a-z0-9.-]+)/gi;

// Repository files outside packages/*/src that can still export telemetry:
// CI workflows (upstream's otel-cicd-action job) and the Worker deploy config
// (upstream's CLOUDFLARE_OTEL_* destinations).
const DEPLOY_AND_CI_FILES = [
	...readdirSync(join(REPO_ROOT, ".github", "workflows"))
		.filter((name) => /\.ya?ml$/.test(name))
		.map((name) => join(REPO_ROOT, ".github", "workflows", name)),
	join(REPO_ROOT, "cloudflare.config.ts"),
	...PACKAGE_NAMES.map((name) =>
		join(REPO_ROOT, "packages", name, "cloudflare.config.ts"),
	).filter((file) => existsSync(file)),
];

describe("widened tripwires (hevy-mcp@6.2.1 vectors)", () => {
	it("names no URL host outside the allowlist in shipped sources", () => {
		const offenders = SHIPPED_SOURCE_FILES.flatMap((file) =>
			Array.from(
				readFileSync(file, "utf8").matchAll(URL_HOST_PATTERN),
				(match) => match[1]?.toLowerCase() ?? "",
			)
				.filter((host) => !ALLOWED_URL_HOSTS.has(host))
				.map((host) => `${file}: ${host}`),
		);

		expect(offenders).toEqual([]);
	});

	// Upstream's `feedback` tool forwards agent-written reports to its OTLP
	// collector through these adapter recorders.
	it("ships no telemetry-backed feedback recorder", () => {
		const offenders = SOURCE_FILES.filter((file) =>
			/(createNodeFeedbackRecorder|createWorkerFeedbackRecorder|getTelemetryAvailability|hevy_mcp\.feedback|isFeedbackToolCall)/.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(offenders).toEqual([]);
	});

	it("exports no traces or logs from CI or the Worker deploy config", () => {
		const offenders = DEPLOY_AND_CI_FILES.filter((file) =>
			/(otel|sentry|opentelemetry|OTEL_|otlp)/i.test(
				readFileSync(file, "utf8"),
			),
		);

		expect(DEPLOY_AND_CI_FILES.length).toBeGreaterThan(2);
		expect(offenders).toEqual([]);
	});

	it("installs and runs no `entire` session recorder", () => {
		const mise = readFileSync(join(REPO_ROOT, "mise.toml"), "utf8");
		const lefthook = readFileSync(join(REPO_ROOT, "lefthook.yml"), "utf8");

		expect(mise).not.toMatch(/^\s*"?entire"?\s*=/m);
		expect(lefthook).not.toMatch(/^\s*run:.*\bentire\b/m);
		expect(existsSync(join(REPO_ROOT, ".entire"))).toBe(false);
	});

	it("opts the Cloudflare CLIs out of telemetry in workflows and mise.toml", () => {
		const files = [
			".github/workflows/build-and-test.yml",
			".github/workflows/deploy-worker.yml",
			".github/workflows/release.yml",
			"mise.toml",
		];
		const missing: string[] = [];
		for (const file of files) {
			const text = readFileSync(join(REPO_ROOT, file), "utf8");
			for (const name of [
				"DO_NOT_TRACK",
				"CF_SEND_TELEMETRY",
				"WRANGLER_SEND_METRICS",
			]) {
				const expected = name === "DO_NOT_TRACK" ? "1" : "false";
				if (
					!new RegExp(`^\\s*${name}\\s*[:=]\\s*"${expected}"`, "m").test(text)
				) {
					missing.push(`${file}:${name}`);
				}
			}
		}

		expect(missing).toEqual([]);
	});
});
