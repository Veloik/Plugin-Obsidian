import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const versions = readJson("versions.json");

assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "manifest version must use x.y.z SemVer");
assert.equal(pkg.version, manifest.version, "package.json and manifest.json versions differ");
assert.equal(lock.packages?.[""]?.version, manifest.version, "package-lock.json version differs");
assert.equal(versions[manifest.version], manifest.minAppVersion, "versions.json does not map the current release");
assert.equal(manifest.id, "notelens", "plugin id changed unexpectedly");
assert.equal(typeof manifest.isDesktopOnly, "boolean", "isDesktopOnly must be a boolean");

for (const [file, minimum] of [["main.js", 100_000], ["manifest.json", 100], ["styles.css", 1_000]]) {
	assert.ok(statSync(file).size >= minimum, `${file} is missing or unexpectedly small`);
}

const bundle = readFileSync("main.js", "utf8");
assert.ok(bundle.includes(`NoteLens ${manifest.version}`) || bundle.includes(`\"${manifest.version}\"`), "bundle has no release version stamp");
assert.doesNotMatch(bundle, /(?:[A-Za-z]:\\Users\\|\/Users\/)[^\s"']+/i, "bundle contains a developer home path");
assert.doesNotMatch(bundle, /sourceMappingURL=data:/, "production bundle contains an inline source map");
// The community review fails a bundle that can inject a <script>. Nothing in
// NoteLens does, and the build strips the one path in jsPDF that did, so a
// reappearance means a dependency brought its own back.
assert.doesNotMatch(bundle, /createElement\(\s*['"`]script['"`]\s*\)/, "bundle creates a <script> element");
assert.ok(bundle.includes("does not bundle the pdfobjectnewwindow"), "the jsPDF remote-viewer patch did not reach the bundle");

console.log(`Release ${manifest.version} validated: main.js, manifest.json and styles.css are ready.`);
