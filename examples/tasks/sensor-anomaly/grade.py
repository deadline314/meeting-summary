"""Grader for 「機台異常偵測」.

The platform runs:  python grade.py <submission_dir> <data_dir> <out_dir>
  submission_dir  the student's file(s); pasted code arrives as main.py
  data_dir        the hidden data (test.csv, labels included)
  out_dir         write result.json here

The student's module must define  predict(rows) -> list[int]  where rows is a list of dicts
(id, temperature, vibration, current, hours_since_service; numbers already parsed) and the
result has one 0/1 per row, in the same order. Score = F1 on the failure class (higher is
better); passing needs F1 >= PASS_F1.
"""
import csv
import importlib.util
import json
import os
import sys
import time
import traceback

PASS_F1 = 0.60
FEATURES = ["temperature", "vibration", "current", "hours_since_service"]


def finish(out, passed, score, message, details=None):
    with open(os.path.join(out, "result.json"), "w", encoding="utf-8") as f:
        json.dump({"passed": passed, "score": score, "message": message, "details": details or []}, f, ensure_ascii=False)
    sys.exit(0)


def load_rows(data):
    path = os.path.join(data, "test.csv")
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    labels = [int(r.pop("label")) for r in rows]
    parsed = [{"id": int(r["id"]), **{k: float(r[k]) for k in FEATURES}} for r in rows]
    return parsed, labels


def load_solution(sub):
    files = sorted(f for f in os.listdir(sub) if f.endswith(".py"))
    if not files:
        return None, "找不到 .py 檔：請提交一個定義 predict(rows) 的 Python 檔"
    name = "main.py" if "main.py" in files else files[0]
    spec = importlib.util.spec_from_file_location("solution", os.path.join(sub, name))
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, sub)  # allow helper modules next to it (zip submissions)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001 - any import-time error is the student's to see
        return None, f"載入 {name} 時發生錯誤：{type(e).__name__}: {e}"
    if not callable(getattr(mod, "predict", None)):
        return None, f"{name} 裡沒有 predict(rows) 函式"
    return mod, None


def scores(pred, gold):
    tp = sum(1 for p, g in zip(pred, gold) if p == 1 and g == 1)
    fp = sum(1 for p, g in zip(pred, gold) if p == 1 and g == 0)
    fn = sum(1 for p, g in zip(pred, gold) if p == 0 and g == 1)
    acc = sum(1 for p, g in zip(pred, gold) if p == g) / len(gold)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return acc, precision, recall, f1


def main():
    sub, data, out = sys.argv[1], sys.argv[2], sys.argv[3]
    rows, gold = load_rows(data)
    mod, err = load_solution(sub)
    if err:
        finish(out, False, None, err)

    started = time.time()
    try:
        # Hand over copies so a solution that mutates its input can't see or change the labels.
        pred = mod.predict([dict(r) for r in rows])
    except Exception as e:  # noqa: BLE001
        tb = traceback.extract_tb(e.__traceback__)[-1]
        finish(out, False, None, f"predict() 執行錯誤：{type(e).__name__}: {e}（{os.path.basename(tb.filename)} 第 {tb.lineno} 行）")
    elapsed = time.time() - started

    try:
        pred = [int(p) for p in pred]
    except (TypeError, ValueError):
        finish(out, False, None, "predict() 必須回傳 0／1 組成的清單")
    if len(pred) != len(gold):
        finish(out, False, None, f"predict() 回傳 {len(pred)} 筆，但輸入有 {len(gold)} 筆；每一筆資料都要有一個預測")
    bad = sorted({p for p in pred if p not in (0, 1)})
    if bad:
        finish(out, False, None, f"預測值只能是 0 或 1，收到了 {bad[:5]}")

    acc, precision, recall, f1 = scores(pred, gold)
    # Slices a careful model should handle, shown as test cases (they don't change the score).
    slices = {
        "高溫（> 70°C）": lambda r: r["temperature"] > 70,
        "強震動（> 4.5 mm/s）": lambda r: r["vibration"] > 4.5,
        "久未保養（> 700 小時）": lambda r: r["hours_since_service"] > 700,
        "一般運轉": lambda r: r["temperature"] <= 70 and r["vibration"] <= 4.5 and r["hours_since_service"] <= 700,
    }
    details = [
        {"name": "整體 F1", "passed": f1 >= PASS_F1, "message": f"{f1:.3f}（門檻 {PASS_F1:.2f}）"},
        {"name": "抓到的故障（召回率）", "passed": recall >= 0.5, "message": f"{recall:.1%}"},
        {"name": "警報可信度（精確率）", "passed": precision >= 0.5, "message": f"{precision:.1%}"},
    ]
    for name, keep in slices.items():
        idx = [i for i, r in enumerate(rows) if keep(r)]
        if not idx:
            continue
        a = sum(1 for i in idx if pred[i] == gold[i]) / len(idx)
        details.append({"name": f"{name} 準確率", "passed": a >= 0.75, "message": f"{a:.1%}（{len(idx)} 筆）"})

    summary = f"F1 {f1:.3f}｜準確率 {acc:.1%}｜精確率 {precision:.1%}｜召回率 {recall:.1%}｜耗時 {elapsed:.2f} 秒"
    if sum(pred) == 0:
        finish(out, False, 0.0, f"沒有預測任何故障（全部回傳 0）。{summary}", details)
    if f1 < PASS_F1:
        finish(out, False, round(f1, 4), f"F1 未達 {PASS_F1:.2f}。{summary}", details)
    finish(out, True, round(f1, 4), summary, details)


if __name__ == "__main__":
    main()
