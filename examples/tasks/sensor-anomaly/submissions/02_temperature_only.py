# 只看溫度：超過 68°C 就當作會故障。
def predict(rows):
    return [1 if r["temperature"] > 68 else 0 for r in rows]
