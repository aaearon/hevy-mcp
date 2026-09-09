import { readdir, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
	releaseCandidateArtifact,
	repositoryRoot,
} from "./release-candidate-artifacts.mjs";

const packDirectory = resolve(repositoryRoot, ".nx/pack");
await rm(packDirectory, { recursive: true, force: true });
await mkdir(packDirectory, { recursive: true });

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packed = spawnSync(
	pnpm,
	[
		"pack",
		"--recursive",
		"--filter",
		"hevy-mcp",
		"--filter",
		"@chrisdoc/hevy-cli",
		"--pack-destination",
		packDirectory,
		// pnpm pack has no `--ignore-scripts` flag; it is set as a config
		// override so prepack/prepare hooks stay disabled as they were under npm.
		"--config.ignore-scripts=true",
		"--reporter",
		"silent",
	],
	{ cwd: repositoryRoot, env: process.env, stdio: "inherit" },
);
if (packed.error) throw packed.error;
if (packed.status !== 0) {
	throw new Error(
		`pnpm pack failed with ${packed.signal ? `signal ${packed.signal}` : `exit code ${packed.status ?? 1}`}`,
	);
}

const candidates = await Promise.all([
	releaseCandidateArtifact("packages/node"),
	releaseCandidateArtifact("packages/cli"),
]);
const expected = candidates.map(({ filename }) => filename).sort();
const found = (await readdir(packDirectory))
	.filter((entry) => entry.endsWith(".tgz"))
	.sort();
if (JSON.stringify(found) !== JSON.stringify(expected)) {
	throw new Error(
		`Release candidate inventory drifted: expected ${expected.join(", ")}; found ${found.join(", ")}`,
	);
}

console.log(`Packed release candidates: ${expected.join(", ")}`);
