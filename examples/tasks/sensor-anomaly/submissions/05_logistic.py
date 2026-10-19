"""用 train.csv 離線訓練的邏輯迴歸（權重由 train_logistic.py 印出），並加入溫度 × 震動的交互作用項。"""
import math

MEAN = [61.7104, 3.0435, 10.0146, 451.0325]
STD = [6.9256, 1.0634, 1.5651, 256.1476]
W = [1.7026, 2.5207, 1.13, 1.9629, 0.1023]
B = -2.9526
THRESHOLD = 0.36
FEATURES = ["temperature", "vibration", "current", "hours_since_service"]


def probability(r):
    z = [(r[k] - m) / s for k, m, s in zip(FEATURES, MEAN, STD)]
    z.append(z[0] * z[1])
    return 1 / (1 + math.exp(-(sum(w * x for w, x in zip(W, z)) + B)))


def predict(rows):
    return [1 if probability(r) >= THRESHOLD else 0 for r in rows]
