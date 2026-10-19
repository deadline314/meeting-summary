# 手調的風險分數：四個感測值各自加權後相加，超過門檻就預警。
def predict(rows):
    out = []
    for r in rows:
        risk = (
            (r["temperature"] - 62) / 7
            + 1.4 * (r["vibration"] - 3.0) / 1.1
            + 0.6 * (r["current"] - 10) / 1.6
            + 1.1 * (r["hours_since_service"] - 450) / 260
        )
        out.append(1 if risk > 1.6 else 0)
    return out
