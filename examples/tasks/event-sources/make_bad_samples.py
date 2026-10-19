"""Builds sample submissions with known mistakes from sample_events.csv, for trying the grader:

    python make_bad_samples.py   →  bad/*.csv
"""
import csv
import os

here = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.reader(open(os.path.join(here, "sample_events.csv"), encoding="utf-8-sig")))
header, body = rows[0], [r for r in rows[1:] if any(r)]
col = {c: i for i, c in enumerate(header)}
os.makedirs(os.path.join(here, "bad"), exist_ok=True)


def save(name, h, b, encoding="utf-8-sig"):
    # errors="replace": like Excel, characters Big5 lacks (é in Pokémon) become "?".
    with open(os.path.join(here, "bad", name), "w", newline="", encoding=encoding, errors="replace") as f:
        csv.writer(f).writerows([h, *b])


def edited(changes):
    out = [list(r) for r in body]
    for (row, column), value in changes.items():
        out[row - 1][col[column]] = value
    return out


# Common slips, one or two per row.
save(
    "01_common_mistakes.csv",
    header,
    edited({
        (2, "活動時間"): "2022/2/26 ~ 2022/2/27",  # wrong date format
        (3, "縣市"): "台北市",  # 台 instead of 臺, and not 高雄
        (4, "區域"): "鹽埕區,苓雅區",  # wrong separator
        (5, "來源網址"): "",  # missing URL
        (6, "活動編號"): "KHH-YC-2023-001",  # duplicate of row 3
        (7, "佐證來源數"): "2",  # 3 URLs
        (8, "資料可信度"): "低",  # needs a reason (備註 blank on row 8)
        (8, "備註"): "",
        (9, "活動類型"): "演唱會",  # not an allowed type
    }),
)
# One required column dropped.
save("02_missing_column.csv", [h for h in header if h != "來源類型"], [[v for i, v in enumerate(r) if header[i] != "來源類型"] for r in body])
# Saved as Big5 (what Excel does by default on zh-TW Windows).
save("03_big5.csv", header, body, encoding="big5")
# Clean apart from a single-day event written as a range.
save("04_almost_right.csv", header, edited({(8, "活動時間"): "2024-12-21 ~ 2024-12-21"}))
print("bad/: " + ", ".join(sorted(os.listdir(os.path.join(here, "bad")))))
