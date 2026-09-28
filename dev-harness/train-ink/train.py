"""Trains the symbol classifier on the features build-dataset.mjs wrote.

    python train.py <dataset-dir> [epochs]

A plain two-hidden-layer perceptron in numpy: small enough to ship inside the
plugin and to evaluate in a millisecond, strong enough to beat template
matching by a wide margin. Writes model.json next to the data; the exporter
turns it into src/ink-model.ts.
"""
import json
import os
import sys
import time

import numpy as np

data_dir = sys.argv[1]
epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 40
meta = json.load(open(os.path.join(data_dir, "meta.json")))
F = meta["featureSize"]
classes = meta["classes"]
C = len(classes)


def load(prefix):
    x = np.fromfile(os.path.join(data_dir, prefix + ".bin"), dtype=np.float32).reshape(-1, F)
    y = np.fromfile(os.path.join(data_dir, prefix + "-labels.bin"), dtype=np.uint16).astype(np.int64)
    return x, y


xt, yt = load("train")
xe, ye = load("eval")
rng = np.random.default_rng(7)
perm = rng.permutation(len(xt))
xt, yt = xt[perm], yt[perm]
nval = len(xt) // 20
xv, yv = xt[:nval], yt[:nval]
xt, yt = xt[nval:], yt[nval:]

mean = xt.mean(0)
std = xt.std(0) + 1e-3
norm = lambda x: (x - mean) / std
xt, xv, xe = norm(xt), norm(xv), norm(xe)

H1 = int(os.environ.get("H1", 384))
H2 = int(os.environ.get("H2", 192))
sizes = [F, H1, H2, C]
W = [rng.normal(0, np.sqrt(2.0 / sizes[i]), (sizes[i], sizes[i + 1])).astype(np.float32) for i in range(3)]
B = [np.zeros(sizes[i + 1], dtype=np.float32) for i in range(3)]
params = W + B
m = [np.zeros_like(p) for p in params]
v = [np.zeros_like(p) for p in params]
lr0 = 2e-3
drop = 0.25
smooth = 0.05
wd = 1e-5


def forward(x, train=False):
    h1 = np.maximum(0, x @ W[0] + B[0])
    d1 = None
    if train:
        d1 = (rng.random(h1.shape) > drop).astype(np.float32) / (1 - drop)
        h1 = h1 * d1
    h2 = np.maximum(0, h1 @ W[1] + B[1])
    d2 = None
    if train:
        d2 = (rng.random(h2.shape) > drop).astype(np.float32) / (1 - drop)
        h2 = h2 * d2
    logits = h2 @ W[2] + B[2]
    return h1, h2, d1, d2, logits


def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def accuracy(x, y):
    pred = np.concatenate([forward(x[i:i + 4096])[4].argmax(1) for i in range(0, len(x), 4096)])
    return (pred == y).mean(), pred


step = 0
batch = 256
for epoch in range(epochs):
    started = time.time()
    lr = lr0 * 0.5 * (1 + np.cos(np.pi * epoch / epochs))
    order = rng.permutation(len(xt))
    total = 0.0
    for i in range(0, len(order), batch):
        idx = order[i:i + batch]
        x, y = xt[idx], yt[idx]
        h1, h2, d1, d2, logits = forward(x, True)
        p = softmax(logits)
        target = np.full_like(p, smooth / C)
        target[np.arange(len(y)), y] += 1 - smooth
        total += -np.sum(target * np.log(p + 1e-9)) / len(y)
        g = (p - target) / len(y)
        gW2 = h2.T @ g
        gB2 = g.sum(0)
        g2 = (g @ W[2].T) * (h2 > 0) * d2
        gW1 = h1.T @ g2
        gB1 = g2.sum(0)
        g1 = (g2 @ W[1].T) * (h1 > 0) * d1
        gW0 = x.T @ g1
        gB0 = g1.sum(0)
        grads = [gW0 + wd * W[0], gW1 + wd * W[1], gW2 + wd * W[2], gB0, gB1, gB2]
        step += 1
        for k, (param, grad) in enumerate(zip(params, grads)):
            m[k] = 0.9 * m[k] + 0.1 * grad
            v[k] = 0.999 * v[k] + 0.001 * grad * grad
            mh = m[k] / (1 - 0.9 ** step)
            vh = v[k] / (1 - 0.999 ** step)
            param -= (lr * mh / (np.sqrt(vh) + 1e-8)).astype(np.float32)
    va, _ = accuracy(xv, yv)
    ea, _ = accuracy(xe, ye) if len(xe) else (0, None)
    print("epoch %2d  loss %.3f  val %.3f  mathwriting %.3f  (%.0fs)" % (epoch + 1, total / (len(order) / batch), va, ea, time.time() - started), flush=True)

ea, pred = accuracy(xe, ye)
confusions = {}
per = {}
for truth, guess in zip(ye, pred):
    per.setdefault(classes[truth], [0, 0])
    per[classes[truth]][1] += 1
    if truth == guess:
        per[classes[truth]][0] += 1
    else:
        key = "%s -> %s" % (classes[truth], classes[guess])
        confusions[key] = confusions.get(key, 0) + 1
print("\nMathWriting (no visto): %.1f %%" % (ea * 100))
print("peores:", ", ".join("%s %d/%d" % (k, a, n) for k, (a, n) in sorted(per.items(), key=lambda kv: kv[1][0] / kv[1][1])[:25]))
print("confusiones:", ", ".join("%s x%d" % kv for kv in sorted(confusions.items(), key=lambda kv: -kv[1])[:30]))

json.dump({
    "classes": classes, "featureVersion": meta["featureVersion"], "featureSize": F,
    "mean": mean.tolist(), "std": std.tolist(),
    "layers": [{"w": W[i].tolist(), "b": B[i].tolist()} for i in range(3)],
    "mathwriting": float(ea)
}, open(os.path.join(data_dir, "model.json"), "w"))
