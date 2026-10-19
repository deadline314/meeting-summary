# 最偷懶的寫法：全部判定為正常。準確率看起來不低（約 75%），但一台故障都抓不到。
def predict(rows):
    return [0 for _ in rows]
