import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDir = mkdtempSync(path.join(tmpdir(), "notelens-tests-"));
const output = path.join(temporaryDir, "core.test.mjs");

try {
	await build({
		entryPoints: ["tests/core.test.ts"],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		outfile: output,
		logLevel: "silent"
	});
	const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(temporaryDir, { recursive: true, force: true });
}
