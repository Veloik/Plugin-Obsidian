// The bench corpus: symbols drawn the way a person writes them, shared by the
// benchmark and by the renderer that draws it — the first version of this file
// was measuring a recogniser against a "3" that looked like an S and an "n"
// that looked like a u, so the render is part of the test, not a nicety.
//
// Coordinates run in a 0..70 box with the baseline near 64 and y growing down.
// Curves go through their control points (Catmull-Rom), which is what makes
// them look handwritten rather than like arcs of a compass.

const SEED = { value: 7 };
const rnd = () => { SEED.value = (SEED.value * 1103515245 + 12345) % 2147483648; return SEED.value / 2147483648; };

/** A smooth line through every control point. */
export const path = (controls, perSegment = 7) => {
	if (controls.length < 3) {
		const out = [];
		for (let i = 0; i < controls.length - 1; i++) {
			for (let s = 0; s < perSegment; s++) {
				const t = s / perSegment;
				out.push([controls[i][0] + (controls[i + 1][0] - controls[i][0]) * t, controls[i][1] + (controls[i + 1][1] - controls[i][1]) * t]);
			}
		}
		out.push(controls[controls.length - 1]);
		return out;
	}
	const pts = [controls[0], ...controls, controls[controls.length - 1]];
	const out = [];
	for (let i = 1; i < pts.length - 2; i++) {
		const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
		for (let s = 0; s < perSegment; s++) {
			const t = s / perSegment, t2 = t * t, t3 = t2 * t;
			out.push([
				0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
				0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
			]);
		}
	}
	out.push(pts[pts.length - 1]);
	return out;
};

/** A straight run, for the marks people really do draw straight. */
export const line = (x1, y1, x2, y2, n = 9) =>
	Array.from({ length: n }, (_, i) => [x1 + (x2 - x1) * i / (n - 1), y1 + (y2 - y1) * i / (n - 1)]);

/** A closed ring, from the top and clockwise, as most people write an o. */
export const ring = (cx, cy, rx, ry, n = 26, from = -0.25) =>
	Array.from({ length: n }, (_, i) => {
		const t = (from + i / (n - 1)) * Math.PI * 2;
		return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
	});

const jitter = (points, amount) => points.map(([x, y]) => [x + (rnd() - 0.5) * amount, y + (rnd() - 0.5) * amount]);

// Every entry is a list of variants; a variant is a list of strokes.
export const SYMBOLS = {
	"0": [[ring(32, 34, 15, 26)]],
	"1": [[line(18, 16, 32, 6), line(32, 6, 32, 64)], [line(32, 6, 32, 64)]],
	"2": [[path([[14, 18], [22, 6], [40, 6], [50, 18], [40, 34], [14, 62], [56, 62]])]],
	"3": [[path([[16, 10], [38, 4], [52, 16], [38, 30], [28, 32], [42, 34], [56, 48], [40, 64], [16, 60]])]],
	"4": [[line(42, 6, 12, 44), line(12, 44, 58, 44), line(42, 6, 42, 64)]],
	"5": [[line(52, 8, 20, 8), line(20, 8, 18, 32), path([[18, 32], [40, 28], [54, 42], [42, 62], [18, 58]])]],
	"6": [[path([[48, 6], [30, 20], [22, 38], [24, 54], [38, 62], [50, 52], [44, 38], [28, 38], [22, 46]])]],
	"7": [[line(12, 8, 56, 8), line(56, 8, 26, 64)]],
	"8": [[path([[36, 6], [24, 14], [38, 26], [48, 38], [38, 60], [22, 50], [34, 30], [44, 16], [36, 6]])]],
	"9": [[path([[48, 20], [36, 8], [24, 18], [32, 32], [46, 28], [48, 16], [46, 40], [38, 64]])]],
	"x": [[line(14, 24, 50, 60), line(50, 24, 14, 60)]],
	"y": [[line(16, 24, 34, 56), line(52, 24, 22, 82)]],
	"a": [[ring(30, 44, 13, 15), line(44, 28, 44, 62)]],
	"b": [[line(16, 4, 16, 60), ring(34, 44, 15, 16, 26, 0.5)]],
	"n": [[line(16, 30, 16, 64), path([[16, 40], [26, 28], [40, 30], [44, 42], [44, 64]])]],
	"t": [[line(32, 6, 32, 62), line(16, 24, 48, 24)]],
	"+": [[line(10, 36, 56, 36), line(33, 14, 33, 58)]],
	"-": [[line(10, 36, 56, 36)]],
	"=": [[line(10, 28, 56, 28), line(10, 44, 56, 44)]],
	"(": [[path([[42, 8], [28, 24], [26, 40], [40, 62]])]],
	")": [[path([[22, 8], [36, 24], [38, 40], [24, 62]])]],
	"sqrt": [[path([[4, 38], [12, 38], [22, 62], [34, 8], [64, 8]])]],
	"int": [[path([[46, 12], [42, 4], [34, 8], [33, 24], [30, 44], [28, 60], [20, 64], [16, 56]])]],
	"sum": [[line(56, 6, 14, 6), line(14, 6, 38, 34), line(38, 34, 14, 62), line(14, 62, 56, 62)]],
	"pi": [[line(10, 24, 58, 24), path([[24, 24], [21, 44], [18, 62]]), path([[46, 24], [46, 48], [50, 62], [58, 58]])]],
	"c": [[path([[48, 30], [34, 24], [22, 34], [22, 50], [34, 62], [48, 56]])]],
	"o": [[ring(32, 44, 14, 16)]],
	"i": [[line(32, 30, 32, 62), line(32, 16, 32, 19, 3)]],
	"d": [[ring(30, 44, 13, 15), line(44, 4, 44, 62)]],
	"m": [[line(12, 32, 12, 62), path([[12, 40], [20, 30], [28, 32], [30, 42], [30, 62]]), path([[30, 40], [38, 30], [46, 32], [48, 42], [48, 62]])]]
};

export const build = (variantStrokes, dx = 0, dy = 0, scale = 1) => variantStrokes.map(points =>
	({ points: jitter(points, 0.8).map(([x, y]) => ({ x: dx + x * scale, y: dy + y * scale })) }));

export const CASES = [];
for (const [expected, variants] of Object.entries(SYMBOLS)) {
	variants.forEach((strokes, i) => CASES.push({ expected, label: `${expected}#${i + 1}`, strokes: build(strokes) }));
}

// Expressions, laid out the way they would sit on a line.
const at = (name, variant, dx, dy = 0, scale = 1) => build(SYMBOLS[name][variant ?? 0], dx, dy, scale);
CASES.push({ expected: "x+1", label: "x+1", strokes: [...at("x", 0, 0), ...at("+", 0, 56), ...at("1", 1, 116)] });
CASES.push({ expected: "2x", label: "2x", strokes: [...at("2", 0, 0), ...at("x", 0, 60)] });
CASES.push({ expected: "x=5", label: "x=5", strokes: [...at("x", 0, 0), ...at("=", 0, 56), ...at("5", 0, 116)] });
CASES.push({ expected: "a+b", label: "a+b", strokes: [...at("a", 0, 0), ...at("+", 0, 56), ...at("b", 0, 116)] });
CASES.push({ expected: "(x+1)", label: "(x+1)", strokes: [...at("(", 0, 0), ...at("x", 0, 40), ...at("+", 0, 92), ...at("1", 1, 148), ...at(")", 0, 180)] });
CASES.push({ expected: "2n+3", label: "2n+3", strokes: [...at("2", 0, 0), ...at("n", 0, 58), ...at("+", 0, 112), ...at("3", 0, 168)] });
CASES.push({ expected: "x-7", label: "x-7", strokes: [...at("x", 0, 0), ...at("-", 0, 56), ...at("7", 0, 112)] });
