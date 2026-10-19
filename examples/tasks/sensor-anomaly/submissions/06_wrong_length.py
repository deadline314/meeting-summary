# 常見錯誤：忘記把每一筆都放進結果（只回傳了被判定故障的那些）。
def predict(rows):
    return [1 for r in rows if r["temperature"] > 68]
