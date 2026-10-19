# 常見錯誤：欄位名稱打錯，執行時會丟出 KeyError。
def predict(rows):
    return [1 if r["temp"] > 68 else 0 for r in rows]
