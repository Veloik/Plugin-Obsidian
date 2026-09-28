/**
 * Names one handwritten glyph with the trained network in ink-model.ts.
 *
 * The network answers a probability for every symbol it knows plus "junk",
 * the class it learned for ink that is not one symbol (two glyphs read
 * together, or a glyph with a stray piece of its neighbour). The recogniser
 * uses junk to decide how to cut strokes into symbols.
 */
import { FEATURE_SIZE, FEATURE_VERSION, FeaturePoint, glyphFeatures } from "./ink-features";
import { INK_MODEL } from "./ink-model";

interface Layer { rows: number; cols: number; weights: Int8Array; scales: Float32Array; bias: Float32Array }

let network: { layers: Layer[]; mean: Float32Array; std: Float32Array } | null = null;

function decode(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
const floats = (base64: string) => new Float32Array(decode(base64).buffer);

function load() {
	if (network) return network;
	if (INK_MODEL.featureVersion !== FEATURE_VERSION) throw new Error("ink-model.ts was trained for another ink-features.ts");
	network = {
		mean: floats(INK_MODEL.mean),
		std: floats(INK_MODEL.std),
		layers: INK_MODEL.layers.map(layer => ({
			rows: layer.rows,
			cols: layer.cols,
			weights: new Int8Array(decode(layer.weights).buffer),
			scales: floats(layer.scales),
			bias: floats(layer.bias)
		}))
	};
	return network;
}

export const SYMBOL_CLASSES: readonly string[] = INK_MODEL.classes;
export const JUNK = "junk";

/** Probabilities over SYMBOL_CLASSES, in that order. */
export function classifyInk(strokes: FeaturePoint[][]): Float32Array {
	return classifyFeatures(glyphFeatures(strokes)).probs;
}

/**
 * Probabilities, and the glyph's embedding: the last hidden layer, scaled to
 * unit length. Two drawings of the same symbol by the same hand land close
 * together there, which is what lets NoteLens learn a person's handwriting
 * from a few corrections (ink-memory.ts).
 */
export function classifyFeatures(raw: Float32Array): { probs: Float32Array; embedding: Float32Array } {
	const net = load();
	let x = new Float32Array(FEATURE_SIZE);
	for (let i = 0; i < FEATURE_SIZE; i++) x[i] = (raw[i] - net.mean[i]) / net.std[i];
	let embedding = new Float32Array(0);
	net.layers.forEach((layer, index) => {
		const out = new Float32Array(layer.cols);
		for (let c = 0; c < layer.cols; c++) {
			let sum = 0;
			const base = c * layer.rows;
			for (let r = 0; r < layer.rows; r++) sum += x[r] * layer.weights[base + r];
			const value = sum * layer.scales[c] + layer.bias[c];
			out[c] = index < net.layers.length - 1 ? Math.max(0, value) : value;
		}
		if (index === net.layers.length - 2) {
			let norm = 0;
			for (const v of out) norm += v * v;
			norm = Math.sqrt(norm) || 1;
			embedding = out.map(v => v / norm);
		}
		x = out;
	});
	return { probs: softmax(x), embedding };
}

function softmax(x: Float32Array): Float32Array {
	let max = -Infinity;
	for (const v of x) max = Math.max(max, v);
	let total = 0;
	for (let i = 0; i < x.length; i++) { x[i] = Math.exp(x[i] - max); total += x[i]; }
	for (let i = 0; i < x.length; i++) x[i] /= total;
	return x;
}
