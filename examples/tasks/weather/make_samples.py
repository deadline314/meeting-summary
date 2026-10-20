"""Builds sample weather files for trying the grader (synthetic values, not real observations):

    python make_samples.py   →  samples/good.csv, samples/good.xlsx-like layout as CSV, samples/bad_*.csv

good.csv covers 2021-12-20 ~ 2022-01-15, across the 2022 station switch (467440 → 467441).
"""
import csv
import datetime as dt
import math
import os
import random

H = ["縣市", "區域", "氣溫", "降雨機率", "風速", "日期", "最高氣溫", "最低氣溫", "降水量", "最大陣風", "氣壓", "相對濕度", "降水時數", "資料來源", "資料來源類型", "資料點編號", "資料點名稱", "資料點緯度", "資料點經度", "距真愛碼頭(km)", "來源網址", "擷取日期", "擷取人", "備註"]
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "samples")
os.makedirs(out, exist_ok=True)
rng = random.Random(7)


def day_row(d):
    t = 19 + 3 * math.sin(d.toordinal() / 9) + rng.uniform(-1, 1)
    tmax, tmin = t + rng.uniform(3, 6), t - rng.uniform(3, 5)
    rain = 0.0 if rng.random() < 0.7 else round(rng.uniform(0.5, 12), 1)
    wind = round(rng.uniform(1.0, 3.5), 1)
    sid = "467440" if d < dt.date(2022, 1, 1) else "467441"
    return {
        "縣市": "高雄市", "區域": "楠梓區", "氣溫": f"{t:.1f}", "降雨機率": "", "風速": f"{wind}",
        "日期": str(d), "最高氣溫": f"{tmax:.1f}", "最低氣溫": f"{tmin:.1f}", "降水量": f"{rain}",
        "最大陣風": f"{wind + rng.uniform(3, 7):.1f}", "氣壓": f"{1015 + rng.uniform(-4, 4):.1f}", "相對濕度": str(rng.randint(60, 85)),
        "降水時數": "0.0" if rain == 0 else f"{rng.uniform(0.5, 6):.1f}",
        "資料來源": "中央氣象署 CODiS", "資料來源類型": "觀測", "資料點編號": sid, "資料點名稱": "高雄",
        "資料點緯度": "22.7346", "資料點經度": "120.2879", "距真愛碼頭(km)": "12.7",
        "來源網址": "https://codis.cwa.gov.tw/StationData", "擷取日期": "2026-10-10", "擷取人": "示範", "備註": "",
    }


def save(name, rows):
    with open(os.path.join(out, name), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=H)
        w.writeheader()
        w.writerows(rows)


start = dt.date(2021, 12, 20)
good = [day_row(start + dt.timedelta(k)) for k in range(27)]
save("good.csv", good)

bad = [dict(r) for r in good]
bad[2]["降水量"] = "T"                     # trace written as T
bad[4]["氣壓"] = "-9.8"                    # special code copied as a number
bad[6]["降雨機率"] = "30"                  # probability on an observation
bad[8]["最低氣溫"] = "30.0"                # higher than the maximum
bad[10]["日期"] = "2021/12/30"             # wrong date format
bad[13]["資料點編號"] = "467440"           # old id after the switch (warning)
bad[15]["區域"] = "鹽埕區、楠梓區"          # area must be the station's one district
bad[17]["相對濕度"] = ""                   # blank without a note (warning)
del bad[20]                                # one missing day (warning)
bad.append(dict(good[5]))                  # duplicated day
save("bad_common_mistakes.csv", bad)

fc = [dict(r) for r in good[:5]]
for r in fc:
    r["資料來源類型"] = "預報"
fc[1]["降雨機率"] = "60"                    # the others are missing → errors
save("bad_forecast_without_probability.csv", fc)
print("samples/: " + ", ".join(sorted(os.listdir(out))))
