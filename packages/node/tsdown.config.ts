/// <reference types="node" />
import { readFileSync } from "node:fs";
import { codecovRollupPlugin } from "@codecov/rollup-plugin";
import { defineConfig } from "tsdown";

interface PackageJsonMeta {
	name?: unknown;
	version?: unknown;
}

const pkgJsonRaw = readFileSync(
	new URL("./package.json", import.meta.url),
	"utf-8",
);
let parsed: PackageJsonMeta;
try {
	parsed = JSON.parse(pkgJsonRaw) as PackageJsonMeta;
} catch (error) {
	throw new Error(`Failed to parse package.json: ${(error as Error).message}`);
}

const { name, version } = parsed;
const isStandaloneBuild = process.env.HEVY_MCP_BUILD_MODE === "standalone";
const codecovToken = process.env.CODECOV_TOKEN?.trim() || undefined;
const enableCodecovBundleAnalysis =
	!isStandaloneBuild && codecovToken !== undefined;

if (
	typeof name !== "string" ||
	typeof version !== "string" ||
	!name ||
	!version
) {
	throw new Error(
		`package.json must provide non-empty string 'name' and 'version'. Got name=${String(
			name,
		)}, version=${String(version)}`,
	);
}
export default defineConfig({
	entry: isStandaloneBuild ? ["src/cli.ts"] : ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	platform: isStandaloneBuild ? "node" : undefined,
	target: isStandaloneBuild ? "node24" : "esnext",
	define: {
		__HEVY_MCP_BUILD__: "true",
		__HEVY_MCP_NAME__: JSON.stringify(name),
		__HEVY_MCP_VERSION__: JSON.stringify(version),
	},
	// The public package intentionally omits source maps: they would expose
	// the private workspace source topology in the tarball.
	sourcemap: false,
	clean: true,
	dts: !isStandaloneBuild,
	deps: isStandaloneBuild
		? {
				alwaysBundle: [/.*/],
				onlyBundle: false,
			}
		: {
				// Keep the private workspace graph inside the public artifact. Only
				// Node's declared runtime dependencies remain external.
				alwaysBundle: ["@hevy-mcp/core", "@hevy-mcp/hevy-client"],
			},
	banner: {
		js: "#!/usr/bin/env node\n// Generated with tsdown\n// https://tsdown.dev",
	},
	outDir: "dist",
	outputOptions: isStandaloneBuild
		? {
				codeSplitting: false,
				entryFileNames: "standalone.mjs",
			}
		: undefined,
	inputOptions: {
		onLog(level, log, defaultHandler) {
			if (
				typeof log === "object" &&
				log !== null &&
				"code" in log &&
				log.code === "SOURCEMAP_BROKEN"
			) {
				return;
			}
			defaultHandler(level, log);
		},
	},
	plugins: [
		...(enableCodecovBundleAnalysis
			? codecovRollupPlugin({
					enableBundleAnalysis: true,
					bundleName: "hevy-mcp",
					uploadToken: codecovToken,
				})
			: []),
	],
});
