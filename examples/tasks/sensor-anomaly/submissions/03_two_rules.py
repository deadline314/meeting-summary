# 兩條經驗規則：太熱或震動太大。
def predict(rows):
    out = []
    for r in rows:
        hot = r["temperature"] > 67
        shaky = r["vibration"] > 3.9
        out.append(1 if hot or shaky else 0)
    return out
