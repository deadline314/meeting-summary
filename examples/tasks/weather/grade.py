"""Grader for 「每日天氣資料收集」: checks a CSV/XLSX of one row per day near 真愛碼頭 (24 columns).
Standard library only.

The platform runs:  python grade.py <submission_dir> <data_dir> <out_dir>
  data_dir may hold config.json: {"from": "2016-10-06", "to": "2026-10-06"}
  (dates outside are errors; without it the file's own first–last day is the period)

Every problem becomes a result detail with `row` (1-based data row, blank rows skipped — the same
numbering as the platform's data viewer), `column` and `level`, so the viewer marks the cell.
Passes with 0 errors; the score is the share of rows without errors (0–100).
Locally:  python grade.py --file my.csv [--from 2016-10-06 --to 2019-12-31]

The rules below follow the assignment text; adjust the constants if 欄位規格 says otherwise.
"""
import csv
import datetime as dt
import io
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

REQUIRED = ["縣市", "區域", "氣溫", "降雨機率", "風速"]
EXTENDED = ["日期", "最高氣溫", "最低氣溫", "降水量", "最大陣風", "氣壓", "相對濕度", "降水時數", "資料來源", "資料來源類型", "資料點編號", "資料點名稱", "資料點緯度", "資料點經度", "距真愛碼頭(km)", "來源網址", "擷取日期", "擷取人", "備註"]
COLUMNS = REQUIRED + EXTENDED
MUST_FILL = {"縣市", "區域", "日期", "資料來源", "資料來源類型", "資料點編號", "資料點名稱", "資料點緯度", "資料點經度", "距真愛碼頭(km)", "來源網址", "擷取日期", "擷取人"}
# Measurements: (low, high, unit). Blank is allowed (the source may not have it) but needs a note.
MEASURES = {
    "氣溫": (-5, 45, "℃"),
    "最高氣溫": (-5, 45, "℃"),
    "最低氣溫": (-5, 45, "℃"),
    "風速": (0, 60, "m/s"),
    "最大陣風": (0, 90, "m/s"),
    "降水量": (0, 1500, "mm"),
    "氣壓": (850, 1100, "hPa"),
    "相對濕度": (0, 100, "%"),
    "降水時數": (0, 24, "小時"),
    "降雨機率": (0, 100, "%"),
}
SOURCE_TYPES = {"觀測", "再分析", "預報", "其他"}
# Not real values in CWA / CODiS downloads: leave blank and write the raw value in 備註.
NOT_A_VALUE = re.compile(r"^(T|t|/|--+|x|X|V|NA|N/A|null|-9\.[5-9]|-99\.?\d*|-999\d*)$")
CITIES = ["臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市", "基隆市", "新竹市", "嘉義市", "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣"]
KAOHSIUNG = {d + "區" for d in "楠梓 左營 鼓山 三民 鹽埕 前金 新興 苓雅 前鎮 旗津 小港 鳳山 林園 大寮 大樹 大社 仁武 鳥松 岡山 橋頭 燕巢 田寮 阿蓮 路竹 湖內 茄萣 永安 彌陀 梓官 旗山 美濃 六龜 甲仙 杉林 內門 茂林 桃源 那瑪夏".split()}
# CODiS「高雄」: 467440 until the 2022 move, 467441 after (check the days around the switch).
KAOHSIUNG_STATION = {"467440", "467441"}
STATION_SWITCH = dt.date(2022, 1, 1)
PIER = (22.6203, 120.2840)  # 真愛碼頭
DIST_TOLERANCE_KM = 1.0
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL = re.compile(r"^https?://[^\s]+$")
MAX_DETAILS = 480


# ---------- reading (same as the event grader) ----------

def read_xlsx(path):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if "xl/sharedStrings.xml" in names:
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        first = wb.find("m:sheets", ns)[0]
        target = rels[first.get(f"{{{ns['r']}}}id")].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(f"{{{ns['m']}}}row"):
            out = []
            for c in row.findall("m:c", ns):
                ref = re.match(r"[A-Z]+", c.get("r", ""))
                col = 0
                for ch in ref.group(0) if ref else "":
                    col = col * 26 + ord(ch) - 64
                col = col - 1 if ref else len(out)
                t = c.get("t")
                v = c.find("m:v", ns)
                if t == "s":
                    val = shared[int(v.text)] if v is not None else ""
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{{{ns['m']}}}t"))
                else:
                    val = v.text if v is not None and v.text is not None else ""
                    # A date Excel turned into a serial number (styled numeric cell in a date column).
                    if t is None and val and c.get("s") and re.fullmatch(r"\d{5}(\.0+)?", val):
                        val = f"@excel-number:{val}"
                out.extend([""] * (col - len(out)))
                if col < len(out):
                    out[col] = val
                else:
                    out.append(val)
            rows.append(out)
        return rows


def read_csv(path):
    raw = open(path, "rb").read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None, "檔案不是 UTF-8 編碼（Excel 請用「CSV UTF-8（逗號分隔）」另存）"
    return list(csv.reader(io.StringIO(text))), None


# ---------- checks ----------

class Report:
    def __init__(self):
        self.items, self.errors, self.warnings, self.bad_rows = [], 0, 0, set()

    def add(self, level, name, message, row=None, column=None):
        if level == "error":
            self.errors += 1
            if row:
                self.bad_rows.add(row)
        else:
            self.warnings += 1
        item = {"name": name, "passed": level != "error", "level": level, "message": message}
        if row:
            item["row"] = row
        if column:
            item["column"] = column
        self.items.append(item)


def parse_date(s):
    try:
        return dt.date.fromisoformat(s) if DATE.match(s) else None
    except ValueError:
        return None


def number(s):
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def km(a, b):
    r = 6371.0
    (la1, lo1), (la2, lo2) = [(math.radians(x), math.radians(y)) for x, y in (a, b)]
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def check_row(rep, n, r, today):
    e = lambda col, msg: rep.add("error", col, msg, n, col)
    w = lambda col, msg: rep.add("warning", col, msg, n, col)
    note = r.get("備註", "").strip()
    for col in COLUMNS:
        v = r.get(col, "")
        if v.startswith("@excel-number:"):
            e(col, f"Excel 把這格轉成了數字（{v.split(':', 1)[1]}），請把儲存格設為文字後重新輸入")
            r[col] = ""
        elif col in MUST_FILL and not v.strip():
            e(col, "必填，不能空白")

    city, area = r.get("縣市", ""), r.get("區域", "")
    if city and city not in CITIES:
        e("縣市", f"「{city}」不是正式名稱" + ("，請用「臺」不用「台」" if city.replace("台", "臺") in CITIES else ""))
    if area and city == "高雄市" and area not in KAOHSIUNG:
        e("區域", f"「{area}」不是高雄市的行政區（填資料點所在的一個區，例如高雄站在楠梓區）")

    day = parse_date(r.get("日期", ""))
    if r.get("日期") and not day:
        e("日期", f"日期格式要是 YYYY-MM-DD（目前是「{r['日期']}」）")

    kind = r.get("資料來源類型", "")
    if kind and kind not in SOURCE_TYPES:
        e("資料來源類型", f"只能是：{'／'.join(sorted(SOURCE_TYPES))}")

    vals = {}
    blanks = []
    for col, (lo, hi, unit) in MEASURES.items():
        v = r.get(col, "").strip()
        if not v:
            blanks.append(col)
            continue
        if NOT_A_VALUE.match(v):
            e(col, f"「{v}」不是真正的數值：留空，並在備註寫出原值")
            continue
        x = number(v)
        if x is None:
            e(col, f"要是數字（單位 {unit}），目前是「{v}」")
        elif not lo <= x <= hi:
            e(col, f"{v} 超出合理範圍 {lo}–{hi} {unit}；如果是特殊代碼請留空並寫在備註")
        else:
            vals[col] = x

    # 降雨機率 is a forecast: required for forecasts, never derived for observations.
    if kind == "預報" and "降雨機率" in blanks:
        e("降雨機率", "資料來源類型是「預報」時必填（當天最高值，%）")
    elif kind in ("觀測", "再分析") and "降雨機率" not in blanks:
        e("降雨機率", "觀測／再分析資料沒有降雨機率，請留空，不要用降水量推算")
    blanks = [b for b in blanks if b != "降雨機率"]
    if blanks and not note:
        w("備註", f"{'、'.join(blanks)} 留空，請在備註說明原因（來源沒有、原值為 T 或 / 等）")

    t, tmax, tmin = vals.get("氣溫"), vals.get("最高氣溫"), vals.get("最低氣溫")
    if tmax is not None and tmin is not None and tmin > tmax:
        e("最低氣溫", f"最低氣溫 {tmin} 高於最高氣溫 {tmax}")
    if t is not None and tmax is not None and t > tmax + 0.05:
        e("氣溫", f"平均氣溫 {t} 高於最高氣溫 {tmax}")
    if t is not None and tmin is not None and t < tmin - 0.05:
        e("氣溫", f"平均氣溫 {t} 低於最低氣溫 {tmin}")
    if vals.get("風速") is not None and vals.get("最大陣風") is not None and vals["最大陣風"] < vals["風速"]:
        e("最大陣風", f"最大陣風 {vals['最大陣風']} 小於平均風速 {vals['風速']}")
    if vals.get("降水量") == 0 and (vals.get("降水時數") or 0) > 0:
        w("降水時數", "降水量是 0 卻有降水時數；若原值是 T（微量）請留空並在備註寫 T")

    sid, sname = r.get("資料點編號", ""), r.get("資料點名稱", "")
    if sname == "高雄" or sid in KAOHSIUNG_STATION:
        if sid and sid not in KAOHSIUNG_STATION:
            e("資料點編號", f"CODiS 高雄站編號是 467440（換站前）或 467441（換站後），目前是「{sid}」")
        elif day and sid == "467441" and day < STATION_SWITCH:
            w("資料點編號", f"{day} 在 2022 年換站前，高雄站通常是 467440，請確認")
        elif day and sid == "467440" and day >= STATION_SWITCH:
            w("資料點編號", f"{day} 在 2022 年換站後，高雄站通常是 467441，請確認")

    lat, lon, dist = number(r.get("資料點緯度", "") or "x"), number(r.get("資料點經度", "") or "x"), number(r.get("距真愛碼頭(km)", "") or "x")
    if r.get("資料點緯度") and (lat is None or not 21.5 <= lat <= 26.5):
        e("資料點緯度", "要是臺灣範圍內的十進位緯度（例如 22.7346）")
    if r.get("資料點經度") and (lon is None or not 118.0 <= lon <= 122.5):
        e("資料點經度", "要是臺灣範圍內的十進位經度（例如 120.2879）")
    if r.get("距真愛碼頭(km)"):
        if dist is None or dist < 0:
            e("距真愛碼頭(km)", "要是公里數（非負數字）")
        elif lat is not None and lon is not None and 21.5 <= lat <= 26.5 and 118 <= lon <= 122.5:
            real = km((lat, lon), PIER)
            if abs(real - dist) > DIST_TOLERANCE_KM:
                w("距真愛碼頭(km)", f"依座標算出約 {real:.1f} km，與填的 {dist:g} km 差超過 {DIST_TOLERANCE_KM:g} km")

    urls = [u.strip() for u in r.get("來源網址", "").split("|")] if r.get("來源網址") else []
    bad = [u for u in urls if not URL.match(u)]
    if bad:
        e("來源網址", f"不是完整的 http(s) 網址：{bad[0]}")

    got = r.get("擷取日期", "")
    if got:
        d = parse_date(got)
        if not d:
            e("擷取日期", f"日期格式要是 YYYY-MM-DD（目前是「{got}」）")
        elif d > today:
            e("擷取日期", "不可晚於今天")
    return day


def grade(path, config):
    rep = Report()
    name = os.path.basename(path).lower()
    if name.endswith(".xlsx"):
        try:
            rows = read_xlsx(path)
        except Exception as ex:  # noqa: BLE001
            return {"passed": False, "score": None, "message": f"讀不到這個 XLSX：{ex}"}
    elif name.endswith(".csv"):
        rows, err = read_csv(path)
        if err:
            return {"passed": False, "score": None, "message": err}
    else:
        return {"passed": False, "score": None, "message": "請上傳 .csv 或 .xlsx"}
    rows = [[c.strip() for c in r] for r in rows]
    if not rows:
        return {"passed": False, "score": None, "message": "檔案是空的"}
    header, body = rows[0], [r for r in rows[1:] if any(c for c in r)]
    missing = [c for c in COLUMNS if c not in header]
    if missing:
        rep.add("error", "表頭", f"缺少欄位：{'、'.join(missing)}（欄位只能多不能少）")
    if header[:5] != REQUIRED:
        rep.add("error", "表頭", f"前 5 欄必須依序是：{'、'.join(REQUIRED)}（目前是 {'、'.join(header[:5])}）")
    if missing:
        return finish(rep, len(body), None, header_ok=False)
    idx = {c: header.index(c) for c in COLUMNS}

    today = dt.date.today()
    lo, hi = parse_date(config.get("from", "")), parse_date(config.get("to", ""))
    seen = {}  # day -> first row
    for n, r in enumerate(body, 1):
        cells = {c: (r[i] if i < len(r) else "") for c, i in idx.items()}
        day = check_row(rep, n, cells, today)
        if not day:
            continue
        if (lo and day < lo) or (hi and day > hi):
            rep.add("error", "日期", f"{day} 不在要求的期間 {lo or '…'} ~ {hi or '…'} 內", n, "日期")
        if day in seen:
            rep.add("error", "日期", f"{day} 重複（第 {seen[day]} 列也是這天），一天只能一列", n, "日期")
        else:
            seen[day] = n

    days = sorted(seen)
    span = None
    if days:
        start, end = lo or days[0], hi or days[-1]
        span = (start, end)
        have = set(days)
        gaps = [start + dt.timedelta(k) for k in range((end - start).days + 1) if start + dt.timedelta(k) not in have]
        if gaps:
            sample = "、".join(str(g) for g in gaps[:8]) + ("…" if len(gaps) > 8 else "")
            rep.add("warning", "日期", f"{start} ~ {end} 缺 {len(gaps)} 天：{sample}。來源真的沒有，或在留言寫查過哪些來源")
    return finish(rep, len(body), span)


def finish(rep, n_rows, span, header_ok=True):
    good = n_rows - len(rep.bad_rows) if header_ok else 0
    score = round(100 * good / n_rows, 1) if n_rows else 0.0
    items = sorted(rep.items, key=lambda d: (d["level"] != "error", d.get("row", 0)))
    shown = items[:MAX_DETAILS]
    head = f"ERROR {rep.errors}｜WARNING {rep.warnings}｜{n_rows} 天" + (f"（{span[0]} ~ {span[1]}）" if span else "")
    head += f"，{good} 天沒有錯誤" if header_ok else "，表頭不對所以沒有逐列檢查"
    if len(items) > len(shown):
        head += f"（只列出前 {len(shown)} 項）"
    if rep.errors:
        return {"passed": False, "score": score, "message": f"{head}。ERROR 要是 0 才算通過", "details": shown}
    return {"passed": True, "score": score, "message": head, "details": shown or [{"name": "格式檢查", "passed": True, "message": "全部通過"}]}


def main():
    args = sys.argv[1:]
    if args and args[0] == "--file":
        config = {k: args[args.index(f"--{k}") + 1] for k in ("from", "to") if f"--{k}" in args}
        r = grade(args[1], config)
        print(r["message"])
        for d in r.get("details", []):
            where = f"第 {d['row']} 列 {d.get('column', '')}" if "row" in d else d["name"]
            print(f"  [{d.get('level', 'ok').upper()}] {where}：{d['message']}")
        sys.exit(0 if r["passed"] else 1)
    sub, data, out = args[0], args[1], args[2]
    cfg = os.path.join(data, "config.json")
    config = json.load(open(cfg, encoding="utf-8")) if os.path.exists(cfg) else {}
    files = sorted(f for f in os.listdir(sub) if f.lower().endswith((".csv", ".xlsx")))
    r = grade(os.path.join(sub, files[0]), config) if files else {"passed": False, "score": None, "message": "找不到 .csv 或 .xlsx 檔"}
    with open(os.path.join(out, "result.json"), "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
