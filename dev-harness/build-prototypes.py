"""Builds symbol prototypes out of real handwriting.

Reads the Hand-TeX database (221,263 samples drawn by people, ODbL, derived
from Detexify) and writes src/ink-prototypes-odbl.ts: for every symbol NoteLens
can name, a handful of samples chosen to cover the ways people actually draw
it — the most typical one first, then the ones least like those already picked.

Only the DATA is used. Hand-TeX's code is GPL-3.0 and is not read, copied or
linked here; the database it publishes is under the Open Database License, so
the file this writes carries that licence and its attribution while the plugin
stays MIT.

    python dev-harness/build-prototypes.py path/to/handtex.db

The database is not in the repository: it is 109 MB, and the generated file is
what NoteLens ships.
"""
import json
import math
import os
import random
import sqlite3
import sys

# How many shapes to keep per symbol. Six covers the usual styles (a sum drawn
# in one stroke or four, an alpha open or closed) without bloating the bundle.
PROTOTYPES_PER_SYMBOL = int(os.environ.get("PROTOS", "6"))
# Points per stroke in the stored shape. The matcher resamples to 32 points
# over the whole symbol, so more than this is thrown away anyway.
POINTS_PER_STROKE = 16
# Samples to consider per symbol before choosing. More is slower, not better.
POOL = int(os.environ.get("POOL", "260"))
CLOUD_POINTS = 32

# LaTeX key in the database -> what NoteLens calls the symbol. Only symbols the
# rest of the plugin already understands; anything else would be recognised and
# then not render.
WANTED = {
    "latex2e-_int": "int", "latex2e-_sum": "sum", "latex2e-_prod": "prod",
    "latex2e-_alpha": "alpha", "latex2e-_beta": "beta", "latex2e-_gamma": "gamma",
    "latex2e-_delta": "delta", "latex2e-_Delta": "Delta", "latex2e-_epsilon": "epsilon",
    "latex2e-_varepsilon": "epsilon", "latex2e-_theta": "theta", "latex2e-_lambda": "lambda",
    "latex2e-_mu": "mu", "latex2e-_pi": "pi", "latex2e-_rho": "rho",
    "latex2e-_sigma": "sigma", "latex2e-_Sigma": "sum", "latex2e-_tau": "tau",
    "latex2e-_phi": "phi", "latex2e-_varphi": "phi", "latex2e-_omega": "omega",
    "latex2e-_Omega": "Omega", "latex2e-_infty": "oo", "latex2e-_partial": "del",
    "latex2e-_nabla": "grad", "latex2e-_approx": "~~", "amssymb-_neq": "!=",
    "latex2e-_pm": "+-", "latex2e-_mp": "-+", "latex2e-_times": "xx", "latex2e-_div": "-:",
    "amssymb-_leq": "<=", "amssymb-_geq": ">=", "latex2e-_in": "in", "latex2e-_notin": "notin",
    "latex2e-_subset": "sub", "latex2e-_subseteq": "sube", "latex2e-_cup": "uu",
    "latex2e-_cap": "nn", "latex2e-_emptyset": "emptyset", "amssymb-_varnothing": "emptyset",
    "latex2e-_forall": "AA", "latex2e-_exists": "EE", "latex2e-_to": "->",
    "latex2e-_rightarrow": "->", "latex2e-_Rightarrow": "=>", "latex2e-_Leftrightarrow": "<=>",
    "latex2e-_equiv": "==", "latex2e-_propto": "prop", "latex2e-_cdot": "*",
    "latex2e-_sqrt": "sqrt", "latex2e-_surd": "sqrt", "latex2e-_angle": "angle",
    "latex2e-_perp": "perp", "latex2e-_parallel": "parallel", "latex2e-_sim": "~~",
    "dsfont-_mathds{R}": "RR", "amssymb-_mathbb{R}": "RR",
    "dsfont-_mathds{N}": "NN", "amssymb-_mathbb{N}": "NN",
    "dsfont-_mathds{Z}": "ZZ", "amssymb-_mathbb{Z}": "ZZ",
    "dsfont-_mathds{Q}": "QQ", "amssymb-_mathbb{Q}": "QQ",
}


def resample(points, n):
    """Even spacing along the path: the same idea the matcher uses."""
    if len(points) < 2:
        return [tuple(points[0])] * n if points else []
    total = sum(math.dist(points[i], points[i - 1]) for i in range(1, len(points)))
    if total <= 0:
        return [tuple(points[0])] * n
    interval = total / (n - 1)
    out = [tuple(points[0])]
    accumulated = 0.0
    working = [list(p) for p in points]
    i = 1
    while i < len(working):
        distance = math.dist(working[i], working[i - 1])
        if accumulated + distance >= interval and distance > 0:
            ratio = (interval - accumulated) / distance
            inserted = [working[i - 1][0] + ratio * (working[i][0] - working[i - 1][0]),
                        working[i - 1][1] + ratio * (working[i][1] - working[i - 1][1])]
            out.append(tuple(inserted))
            working.insert(i, inserted)
            accumulated = 0.0
        else:
            accumulated += distance
        i += 1
    while len(out) < n:
        out.append(out[-1])
    return out[:n]


def cloud(strokes):
    """The sample as the matcher sees it: resampled, uniformly scaled, centred."""
    flat = [(x, y, sid) for sid, stroke in enumerate(strokes) for x, y in stroke]
    if len(flat) < 2:
        return None
    points = resample([(p[0], p[1]) for p in flat], CLOUD_POINTS)
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    size = max(max(xs) - min(xs), max(ys) - min(ys)) or 1
    scaled = [((x - min(xs)) / size, (y - min(ys)) / size) for x, y in points]
    cx = sum(p[0] for p in scaled) / len(scaled)
    cy = sum(p[1] for p in scaled) / len(scaled)
    return [(x - cx, y - cy) for x, y in scaled]


def distance(a, b):
    """Cheap stand-in for the runtime matcher: enough to tell styles apart."""
    return sum(math.dist(p, q) for p, q in zip(a, b)) / len(a)


def pick(samples):
    """The most typical shape first, then the ones least like what is chosen.

    With MODE=random it simply samples instead: for a nearest-neighbour match
    an unbiased handful of real examples beats a curated one, because the point
    is to cover how people write rather than to describe an average."""
    if os.environ.get("MODE") == "random":
        return random.sample(samples, min(PROTOTYPES_PER_SYMBOL, len(samples)))
    clouds = [(s, cloud(s)) for s in samples]
    clouds = [(s, c) for s, c in clouds if c]
    if not clouds:
        return []
    average = []
    for i, (_, ci) in enumerate(clouds):
        total = sum(distance(ci, cj) for j, (_, cj) in enumerate(clouds) if i != j)
        average.append((total / max(1, len(clouds) - 1), i))
    average.sort()
    chosen = [average[0][1]]
    while len(chosen) < min(PROTOTYPES_PER_SYMBOL, len(clouds)):
        best, index = -1.0, None
        for i, (_, ci) in enumerate(clouds):
            if i in chosen:
                continue
            near = min(distance(ci, clouds[j][1]) for j in chosen)
            # Far from everything chosen, but still a plausible example of the
            # symbol: the outliers of an outlier are mislabelled samples.
            if near > best and average[[a[1] for a in average].index(i)][0] < average[len(average) * 3 // 4][0]:
                best, index = near, i
        if index is None:
            break
        chosen.append(index)
    return [clouds[i][0] for i in chosen]


def compact(strokes):
    """Stroke points as integers 0..99, which is finer than the matcher needs."""
    xs = [x for stroke in strokes for x, _ in stroke]
    ys = [y for stroke in strokes for _, y in stroke]
    if not xs:
        return ""
    size = max(max(xs) - min(xs), max(ys) - min(ys)) or 1
    out = []
    for stroke in strokes:
        points = resample(stroke, min(POINTS_PER_STROKE, max(2, len(stroke))))
        out.append(",".join("%d %d" % (round((x - min(xs)) / size * 99), round((y - min(ys)) / size * 99))
                            for x, y in points))
    return ";".join(out)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "handtex.db"
    if not os.path.exists(path):
        sys.exit("no encuentro %s — descarga handtex.db.tar.xz de Hand-TeX y extráelo" % path)
    db = sqlite3.connect(path)
    random.seed(11)

    by_value = {}
    for key, value in sorted(WANTED.items()):
        rows = db.execute("select strokes from samples where key = ?", (key,)).fetchall()
        if not rows:
            print("  (sin muestras) %s" % key)
            continue
        if len(rows) > POOL:
            rows = random.sample(rows, POOL)
        samples = []
        for (raw,) in rows:
            try:
                strokes = [[(float(x), float(y)) for x, y in stroke] for stroke in json.loads(raw) if len(stroke) >= 2]
            except Exception:
                continue
            if strokes:
                samples.append(strokes)
        for shape in pick(samples):
            by_value.setdefault(value, []).append(compact(shape))
        print("  %-28s -> %-9s %4d muestras" % (key, value, len(samples)))

    lines = []
    for value in sorted(by_value):
        for shape in by_value[value]:
            lines.append('\t["%s", "%s"],' % (value.replace('"', '\\"'), shape))

    header = '''/**
 * Symbol shapes taken from handwriting people actually produced.
 *
 * Generated by dev-harness/build-prototypes.py from the Hand-TeX database
 * (221,263 samples, itself derived from the Detexify training data). Each
 * entry is a symbol and one way somebody drew it: strokes separated by ";",
 * points by ",", coordinates as "x y" on a 0..99 grid.
 *
 * ---------------------------------------------------------------------------
 * DATA LICENCE — this file only
 * ---------------------------------------------------------------------------
 * The shapes below are a derivative database of the Hand-TeX dataset, which is
 * published under the Open Database License (ODbL) v1.0, as is the Detexify
 * data it extends. This file is therefore offered under the ODbL as well:
 *
 *   Hand-TeX dataset © VoxelCubes, ODbL v1.0
 *     https://github.com/VoxelCubes/Hand-TeX
 *   Detexify data © Daniel Kirsch, ODbL v1.0
 *     https://github.com/kirel/detexify-data
 *   ODbL v1.0: https://opendatacommons.org/licenses/odbl/1-0/
 *
 * The rest of NoteLens stays under the MIT licence. No Hand-TeX code (GPL-3.0)
 * is used, copied or linked: only its published database was read.
 *
 * Digits and Latin letters are not in here. Detexify collected drawings of
 * LaTeX commands, so nobody drew a "2" or an "x"; those prototypes are still
 * the hand-written ones in ink-shapes.ts.
 */

/** [symbol, "x y,x y,…;x y,…"] — strokes separated by ";", points by ",". */
export const HANDWRITTEN_SHAPES: [string, string][] = [
'''
    out = header + "\n".join(lines) + "\n];\n"
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "ink-prototypes-odbl.ts")
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(out)
    print("\n%d formas de %d símbolos -> %s (%.0f KB)" % (
        len(lines), len(by_value), os.path.relpath(target), len(out) / 1024))


if __name__ == "__main__":
    main()
