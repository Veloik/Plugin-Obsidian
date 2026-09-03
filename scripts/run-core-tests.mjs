import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDir = mkdtempSync(path.join(tmpdir(), "notelens-tests-"));
const output = path.join(temporaryDir, "core.test.mjs");

// The core tests run outside Obsidian, so the modules under test cannot import
// the real API. Only what they actually reach for is stubbed; anything else
// would fail loudly rather than pass against a fake.
const obsidianStub = {
	name: "obsidian-stub",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "obsidian-stub" }));
		build.onLoad({ filter: /.*/, namespace: "obsidian-stub" }, () => ({
			contents: 'export function getLanguage() { return "es"; }',
			loader: "js"
		}));
	}
};

try {
	await build({
		entryPoints: ["tests/core.test.ts"],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		outfile: output,
		logLevel: "silent",
		plugins: [obsidianStub]
	});
	const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(temporaryDir, { recursive: true, force: true });
}
