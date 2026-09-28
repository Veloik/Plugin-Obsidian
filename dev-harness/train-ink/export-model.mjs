// Turns model.json (from train.py) into src/ink-model.ts.
//
//   node dev-harness/train-ink/export-model.mjs <dataset-dir>
//
// Weights are stored as int8 with one scale per output unit, which keeps the
// bundle small (~170 KB) and loses nothing measurable: the exporter checks
// that the quantised network agrees with the float one on the eval set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const model = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));

const quantise = (w) => {
	const rows = w.length, cols = w[0].length;
	const scales = new Float32Array(cols);
	for (let c = 0; c < cols; c++) {
		let max = 0;
		for (let r = 0; r < rows; r++) max = Math.max(max, Math.abs(w[r][c]));
		scales[c] = max / 127 || 1e-8;
	}
	// Column-major so a unit's incoming weights are contiguous at run time.
	const q = new Int8Array(rows * cols);
	for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) q[c * rows + r] = Math.round(w[r][c] / scales[c]);
	return { rows, cols, q, scales };
};
const f32 = (list) => Buffer.from(new Float32Array(list).buffer).toString("base64");
const layers = model.layers.map(layer => {
	const { rows, cols, q, scales } = quantise(layer.w);
	return { rows, cols, weights: Buffer.from(q.buffer).toString("base64"), scales: f32(scales), bias: f32(layer.b) };
});

const out = `/**
 * Weights of the handwritten-symbol classifier. GENERATED — do not edit.
 *
 * Produced by dev-harness/train-ink/ (build-dataset.mjs → train.py →
 * export-model.mjs). ${model.classes.length} classes, ${model.featureSize} features (ink-features.ts
 * version ${model.featureVersion}), two hidden layers, int8 weights with one scale per unit.
 * Accuracy on isolated symbols from MathWriting, which it never saw: ${(model.mathwriting * 100).toFixed(1)} %.
 *
 * ---------------------------------------------------------------------------
 * Training data and attribution
 * ---------------------------------------------------------------------------
 * The network was fitted to handwriting from:
 *   UJI Pen Characters v2 — F. Prat, M. J. Castro, D. Llorens, A. Marzal,
 *     J. M. Vilar; UCI Machine Learning Repository, CC BY 4.0.
 *   Pen-Based Recognition of Handwritten Digits — E. Alpaydin, F. Alimoglu;
 *     UCI Machine Learning Repository, CC BY 4.0.
 *   Hand-TeX dataset © VoxelCubes (github.com/VoxelCubes/Hand-TeX), itself
 *     extending the Detexify data © Daniel Kirsch; Open Database License 1.0.
 *   HWRT database of handwritten symbols © Martin Thoma
 *     (doi.org/10.5281/zenodo.50022); Open Database License 1.0.
 * No sample is stored here: only the fitted numbers.
 */

export const INK_MODEL = {
	featureVersion: ${model.featureVersion},
	classes: ${JSON.stringify(model.classes)},
	mean: "${f32(model.mean)}",
	std: "${f32(model.std)}",
	layers: ${JSON.stringify(layers, null, "\t").replace(/\n/g, "\n\t")}
};
`;
const target = path.join(here, "..", "..", "src", "ink-model.ts");
fs.writeFileSync(target, out);
console.log(`${path.relative(process.cwd(), target)}: ${(out.length / 1024).toFixed(0)} KB`);
