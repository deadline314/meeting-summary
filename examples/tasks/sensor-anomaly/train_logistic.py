"""Reference workflow a student might follow: fit logistic regression on train.csv offline
(pure Python, no numpy), then paste the printed weights into the submission.

    python train_logistic.py
"""
import csv
import math
import os

FEATURES = ["temperature", "vibration", "current", "hours_since_service"]
here = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.DictReader(open(os.path.join(here, "train.csv"), encoding="utf-8")))
X = [[float(r[k]) for k in FEATURES] for r in rows]
y = [int(r["label"]) for r in rows]

# Standardise, plus one interaction feature (heat × vibration).
mean = [sum(c) / len(c) for c in zip(*X)]
std = [math.sqrt(sum((v - m) ** 2 for v in c) / len(c)) for c, m in zip(zip(*X), mean)]


def feats(x):
    z = [(v - m) / s for v, m, s in zip(x, mean, std)]
    return z + [z[0] * z[1]]


Z = [feats(x) for x in X]
w = [0.0] * len(Z[0])
b = 0.0
for _ in range(3000):
    gw = [0.0] * len(w)
    gb = 0.0
    for z, t in zip(Z, y):
        p = 1 / (1 + math.exp(-(sum(a * c for a, c in zip(w, z)) + b)))
        for j, c in enumerate(z):
            gw[j] += (p - t) * c
        gb += p - t
    w = [a - 0.5 * g / len(Z) for a, g in zip(w, gw)]
    b -= 0.5 * gb / len(Z)

# Pick the threshold with the best F1 on the training set.
probs = [1 / (1 + math.exp(-(sum(a * c for a, c in zip(w, z)) + b))) for z in Z]
best = max(
    ((th, (lambda tp, fp, fn: 2 * tp / (2 * tp + fp + fn) if tp else 0)(
        sum(p >= th and t for p, t in zip(probs, y)), sum(p >= th and not t for p, t in zip(probs, y)), sum(p < th and t for p, t in zip(probs, y))))
     for th in [i / 100 for i in range(10, 90)]),
    key=lambda x: x[1],
)
print("MEAN =", [round(v, 4) for v in mean])
print("STD =", [round(v, 4) for v in std])
print("W =", [round(v, 4) for v in w])
print("B =", round(b, 4))
print("THRESHOLD =", best[0], "# train F1", round(best[1], 3))
