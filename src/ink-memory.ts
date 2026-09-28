/**
 * Your handwriting, remembered.
 *
 * The network was trained on other people. When you correct a symbol in the
 * equation dialog, or accept one it was unsure of, the glyph is kept here as
 * an example of how YOU write it; later readings look for your closest
 * examples and lean towards what you said they were. A few corrections are
 * enough for a hand whose 1 looks like someone else's 7.
 *
 * Only the glyph's features are kept (336 numbers, one byte each), not the
 * ink, and they stay in the plugin's own settings on this device.
 */
import { FEATURE_SIZE, FEATURE_VERSION, FeaturePoint, glyphFeatures } from "./ink-features";
import { classifyFeatures } from "./ink-classifier";

interface Sample { label: string; features: Float32Array; embedding?: Float32Array }

/** Enough to cover a whole alphabet several times over, small enough for data.json. */
const MAX_SAMPLES = 400;
const PER_LABEL = 20;
/** Embedding distance within which an example counts; see dev-harness/train-ink. */
const REACH = 0.62;

let samples: Sample[] = [];
let persist: ((packed: string[]) => void) | null = null;

// Features are fractions square-rooted into 0..1, plus a few signed values;
// −1..1.5 in 256 steps loses nothing the classifier can feel.
const LOW = -1, HIGH = 1.5;
function pack(sample: Sample): string {
	const bytes = new Uint8Array(FEATURE_SIZE);
	for (let i = 0; i < FEATURE_SIZE; i++) bytes[i] = Math.round((Math.min(HIGH, Math.max(LOW, sample.features[i])) - LOW) / (HIGH - LOW) * 255);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return `${FEATURE_VERSION}\t${sample.label}\t${btoa(binary)}`;
}
function unpack(line: string): Sample | null {
	const [version, label, data] = line.split("\t");
	if (Number(version) !== FEATURE_VERSION || !label || !data) return null;
	try {
		const binary = atob(data);
		if (binary.length !== FEATURE_SIZE) return null;
		const features = new Float32Array(FEATURE_SIZE);
		for (let i = 0; i < FEATURE_SIZE; i++) features[i] = binary.charCodeAt(i) / 255 * (HIGH - LOW) + LOW;
		return { label, features };
	} catch {
		return null;
	}
}

/** Called once by the plugin with what data.json holds, and how to save it. */
export function loadInkMemory(packed: unknown, save: (packed: string[]) => void): void {
	samples = Array.isArray(packed) ? packed.filter((v): v is string => typeof v === "string").map(unpack).filter((s): s is Sample => !!s) : [];
	persist = save;
}

export function inkMemorySize(): number {
	return samples.length;
}

export function forgetInk(): void {
	samples = [];
	persist?.([]);
}

/** Keeps a glyph as an example of `label` in this hand. */
export function rememberInk(strokes: FeaturePoint[][], label: string): void {
	if (!label || !strokes.some(s => s.length)) return;
	const features = glyphFeatures(strokes);
	samples.push({ label, features });
	// Oldest examples of the same symbol make room first, then the oldest overall.
	const same = samples.filter(s => s.label === label);
	if (same.length > PER_LABEL) samples.splice(samples.indexOf(same[0]), 1);
	if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

/** Writes what was learned; one save for a whole formula. */
export function saveInkMemory(): void {
	persist?.(samples.map(pack));
}

/**
 * Votes of your own examples for a glyph with this embedding: label → weight,
 * about 1 for an example drawn the same way, fading to 0 at REACH.
 */
export function personalVotes(embedding: Float32Array): Map<string, number> {
	const votes = new Map<string, number>();
	if (!samples.length || !embedding.length) return votes;
	const near: { label: string; d: number }[] = [];
	for (const sample of samples) {
		sample.embedding ??= classifyFeatures(sample.features).embedding;
		let dot = 0;
		for (let i = 0; i < embedding.length; i++) dot += embedding[i] * sample.embedding[i];
		const d = Math.sqrt(Math.max(0, 2 - 2 * dot));
		if (d < REACH) near.push({ label: sample.label, d });
	}
	near.sort((a, b) => a.d - b.d);
	for (const { label, d } of near.slice(0, 3)) {
		const w = Math.exp(-((d / (REACH * 0.55)) ** 2));
		votes.set(label, (votes.get(label) ?? 0) + w);
	}
	return votes;
}
