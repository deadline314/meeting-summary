"""機台異常偵測：學生範本。

實作 predict(rows)：
- rows 是一個 list，每筆是 dict：
  {"id": 1001, "temperature": 68.1, "vibration": 3.88, "current": 6.84, "hours_since_service": 92.0}
- 回傳一個同樣長度的 list，依序放 0（正常）或 1（一天內會故障）。

本機自我檢查：python starter.py（用 train.csv 算你的 F1）
"""


def predict(rows):
    # TODO: 換成你的判斷方式
    return [1 if r["temperature"] > 70 else 0 for r in rows]


if __name__ == "__main__":
    import csv

    rows = list(csv.DictReader(open("train.csv", encoding="utf-8")))
    gold = [int(r.pop("label")) for r in rows]
    rows = [{k: float(v) for k, v in r.items()} for r in rows]
    pred = predict(rows)
    tp = sum(p == g == 1 for p, g in zip(pred, gold))
    fp = sum(p == 1 and g == 0 for p, g in zip(pred, gold))
    fn = sum(p == 0 and g == 1 for p, g in zip(pred, gold))
    f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
    print(f"train F1 = {f1:.3f}")
