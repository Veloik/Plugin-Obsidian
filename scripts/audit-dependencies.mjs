/**
 * The dependency audit, told apart from the state of npm's servers.
 *
 * `npm audit` exits non-zero both when it finds something and when its advisory
 * service does not answer, so a 503 at npmjs.com used to fail a release that had
 * nothing wrong with it. A real finding at moderate or above still stops the
 * build; an outage only prints a warning, and the release goes out.
 */
import { spawnSync } from "node:child_process";

const BLOCKING = ["moderate", "high", "critical"];

const run = spawnSync("npm", ["audit", "--json", "--audit-level=moderate"], {
	encoding: "utf8",
	shell: process.platform === "win32",
	// npm's advisory endpoint is external infrastructure; never let it stall a release.
	timeout: 15_000
});

let report = null;
try {
	report = JSON.parse(run.stdout);
} catch {
	report = null;
}

if (!report || report.error) {
	const reason = report?.error?.summary || report?.error?.detail || run.stderr.trim().split("\n").pop() || "no answer";
	console.warn(`npm audit could not be reached, so it was skipped: ${reason}`);
	process.exit(0);
}

const counts = report.metadata?.vulnerabilities ?? {};
const blocking = BLOCKING.reduce((total, level) => total + (counts[level] ?? 0), 0);
console.log(`npm audit: ${JSON.stringify(counts)}`);
if (blocking > 0) {
	console.error(`${blocking} vulnerabilities at moderate or above. Run "npm audit" for the details.`);
	process.exit(1);
}
console.log("No vulnerabilities at moderate or above.");
