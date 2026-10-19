"""Generates the sensor-anomaly dataset.

    python make_data.py            # train.csv (for students) + hidden/test.csv (upload as hidden data)
    python make_data.py --seed 7   # a different dataset for a new semester

Each row is one hourly reading from a lab machine; `label` is 1 when the machine failed within
the next day. The hidden test set comes from the same process, so a model that learns the
train set generalises to it.
"""
import argparse
import csv
import math
import os
import random

FIELDS = ["id", "temperature", "vibration", "current", "hours_since_service", "label"]


def reading(rng: random.Random, i: int):
    temperature = rng.gauss(62, 7)  # °C
    vibration = max(0.2, rng.gauss(3.0, 1.1))  # mm/s RMS
    current = max(4.0, rng.gauss(10.0, 1.6))  # A
    hours = rng.uniform(0, 900)  # since last maintenance
    # Failure risk rises with heat, vibration, load and time since service; the effects interact
    # a little (hot *and* shaking is worse than either), plus noise no feature can explain.
    z = (
        0.11 * (temperature - 62)
        + 0.95 * (vibration - 3.0)
        + 0.35 * (current - 10.0)
        + 0.0035 * (hours - 450)
        + 0.06 * max(0, temperature - 66) * max(0, vibration - 3.2)
        - 1.35
        + rng.gauss(0, 0.6)
    )
    label = 1 if rng.random() < 1 / (1 + math.exp(-3 * z)) else 0
    return {
        "id": i,
        "temperature": round(temperature, 1),
        "vibration": round(vibration, 2),
        "current": round(current, 2),
        "hours_since_service": round(hours),
        "label": label,
    }


def write(path, rows, with_label=True):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS if with_label else FIELDS[:-1])
        w.writeheader()
        for r in rows:
            w.writerow(r if with_label else {k: r[k] for k in FIELDS[:-1]})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--seed", type=int, default=2026)
    a = p.parse_args()
    rng = random.Random(a.seed)
    train = [reading(rng, i) for i in range(1, 801)]
    test = [reading(rng, i) for i in range(1001, 1501)]
    here = os.path.dirname(os.path.abspath(__file__))
    write(os.path.join(here, "train.csv"), train)
    write(os.path.join(here, "hidden", "test.csv"), test)
    pos = lambda rows: sum(r["label"] for r in rows) / len(rows)
    print(f"train {len(train)} rows ({pos(train):.0%} failures), test {len(test)} rows ({pos(test):.0%} failures)")


if __name__ == "__main__":
    main()
