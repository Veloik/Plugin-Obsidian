"""Sets aside real samples the prototype builder never saw.

Answers the only question that matters about the Hand-TeX data: does the reader
get better at maths symbols when the shapes come from people instead of from
one person guessing? Every sample here is drawn by somebody and was excluded
from the prototypes, so it is a fair test rather than a rehearsal.

    python dev-harness/make-holdout.py path/to/handtex.db [salida.json]

The output is not committed: it is ODbL data, and it belongs to whoever runs
the test, not to the repository.
"""
import json
import os
import random
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader

builder = SourceFileLoader("builder", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-prototypes.py")).load_module()

PER_SYMBOL = 25


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else "handtex.db"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "ink-holdout.json"
    db = sqlite3.connect(db_path)

    cases = []
    for key, value in sorted(builder.WANTED.items()):
        rows = db.execute("select id, strokes from samples where key = ?", (key,)).fetchall()
        if len(rows) < 40:
            continue
        # The builder samples with seed 11 and a pool of 260; drawing from a
        # different seed and skipping that pool keeps the two sets apart.
        random.seed(11)
        used = {r[0] for r in (random.sample(rows, builder.POOL) if len(rows) > builder.POOL else rows)}
        rest = [r for r in rows if r[0] not in used]
        if len(rest) < 5:
            continue
        random.seed(97)
        for sample_id, raw in random.sample(rest, min(PER_SYMBOL, len(rest))):
            try:
                strokes = [[{"x": float(x), "y": float(y)} for x, y in stroke]
                           for stroke in json.loads(raw) if len(stroke) >= 2]
            except Exception:
                continue
            if strokes:
                cases.append({"id": sample_id, "expected": value, "key": key, "strokes": strokes})

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(cases, handle)
    symbols = len({c["expected"] for c in cases})
    print("%d muestras reales de %d símbolos -> %s" % (len(cases), symbols, out_path))


if __name__ == "__main__":
    main()
