"""Grader for BAB-6 「活動資料來源收集」: checks a CSV/XLSX against the 20-column spec
(sample_events.xlsx「欄位規格」). Standard library only.

The platform runs:  python grade.py <submission_dir> <data_dir> <out_dir>
  data_dir may hold config.json: {"from": "2016-10-07", "to": "2026-10-07"} (the period to cover)

Every problem becomes a result detail with `row` (1-based data row, blank rows skipped — the same
numbering as the platform's data viewer), `column` and `level`, so the viewer can mark the cell.
Passes when there are 0 errors; the score is the share of rows without errors (0–100).
Run locally the same way, or:  python grade.py --file my.csv [--from 2016-10-07 --to 2018-12-31]
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

REQUIRED = ["縣市", "區域", "活動名稱", "活動範圍", "活動時間"]
EXTENDED = ["活動編號", "開始日期", "結束日期", "活動時段", "活動類型", "主辦單位", "範圍判定", "來源名稱", "來源類型", "來源網址", "佐證來源數", "資料可信度", "擷取日期", "擷取人", "備註"]
COLUMNS = REQUIRED + EXTENDED
MAY_BE_BLANK = {"活動時段", "備註"}
CITIES = ["臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市", "基隆市", "新竹市", "嘉義市", "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣"]
KAOHSIUNG = "楠梓 左營 鼓山 三民 鹽埕 前金 新興 苓雅 前鎮 旗津 小港 鳳山 林園 大寮 大樹 大社 仁武 鳥松 岡山 橋頭 燕巢 田寮 阿蓮 路竹 湖內 茄萣 永安 彌陀 梓官 旗山 美濃 六龜 甲仙 杉林 內門 茂林 桃源 那瑪夏".split()
KAOHSIUNG = {d + "區" for d in KAOHSIUNG}
EVENT_TYPES = {"節慶燈會", "展覽裝置", "音樂演出", "市集美食", "體育賽事", "宣傳聯名", "綜合活動", "其他"}
SOURCE_TYPES = {"官方公告", "新聞媒體", "部落格", "社群貼文", "其他"}
SCOPES = {"核心", "周邊"}
TRUST = {"高", "中", "低"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SPAN = re.compile(r"^(\d{4}-\d{2}-\d{2})(?: ~ (\d{4}-\d{2}-\d{2}))?$")
EVENT_ID = re.compile(r"^KHH-YC-(\d{4})-(\d{3})$")
URL = re.compile(r"^https?://[^\s]+$")
MAX_DETAILS = 480


# ---------- reading ----------

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
        sheets = wb.find("m:sheets", ns)
        first = sheets[0]  # the first sheet holds the data (the template's「events」)
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
                    # Excel may have turned a date into a serial number: say so instead of guessing.
                    if t is None and val and re.fullmatch(r"\d+(\.\d+)?", val) and c.get("s"):
                        val = f"@excel-number:{val}"
                out.extend([""] * (col - len(out)))
                if col < len(out):
                    out[col] = val
                else:
                    out.append(val)
            rows.append(out)
        return first.get("name"), rows


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
        self.items = []
        self.errors = 0
        self.warnings = 0
        self.bad_rows = set()

    def add(self, level, name, message, row=None, column=None):
        if level == "error":
            self.errors += 1
            if row:
                self.bad_rows.add(row)
        else:
            self.warnings += 1
        item = {"name": name, "passed": False if level == "error" else True, "level": level, "message": message}
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


def check_row(rep, n, r, ids, today):
    e = lambda col, msg: rep.add("error", col, msg, n, col)
    w = lambda col, msg: rep.add("warning", col, msg, n, col)
    for col in COLUMNS:
        v = r.get(col, "")
        if v.startswith("@excel-number:"):
            e(col, f"Excel 把這格轉成了數字（{v.split(':', 1)[1]}），請把儲存格設為文字後重新輸入")
            r[col] = ""
        elif col not in MAY_BE_BLANK and not v.strip():
            e(col, "必填，不能空白")
    city, area = r.get("縣市", ""), r.get("區域", "")
    if city and city not in CITIES:
        e("縣市", f"「{city}」不是正式名稱" + ("，請用「臺」不用「台」" if city.replace("台", "臺") in CITIES else ""))
    if area:
        parts = area.split("、")
        if re.search(r"[,，/／;；]", area):
            e("區域", f"跨區請用「、」分隔（目前是「{area}」）")
        elif any(not p.strip() or p != p.strip() for p in parts):
            e("區域", "跨區請用「、」分隔，前後不要有空白")
        elif city == "高雄市":
            wrong = [p for p in parts if p not in KAOHSIUNG]
            if wrong:
                e("區域", f"不是高雄市的行政區：{'、'.join(wrong)}")
    start, end = parse_date(r.get("開始日期", "")), parse_date(r.get("結束日期", ""))
    for col, d in (("開始日期", start), ("結束日期", end)):
        if r.get(col) and not d:
            e(col, f"日期格式要是 YYYY-MM-DD（目前是「{r[col]}」）")
    span = r.get("活動時間", "")
    m = SPAN.match(span)
    if span and not m:
        e("活動時間", f"格式要是 YYYY-MM-DD 或 YYYY-MM-DD ~ YYYY-MM-DD（~ 前後各一個空白），目前是「{span}」")
    elif m:
        a, b = parse_date(m.group(1)), parse_date(m.group(2) or m.group(1))
        if not a or not b:
            e("活動時間", f"不是存在的日期：「{span}」")
        else:
            if m.group(2) and a == b:
                e("活動時間", "單日活動只寫一天，不用寫成「X ~ X」")
            if b < a:
                e("活動時間", "結束日早於開始日")
            if start and start != a:
                e("開始日期", f"與活動時間不一致（活動時間從 {a} 開始）")
            if end and end != b:
                e("結束日期", f"與活動時間不一致（活動時間到 {b} 結束）")
    eid = r.get("活動編號", "")
    if eid:
        m = EVENT_ID.match(eid)
        if not m:
            e("活動編號", f"格式要是 KHH-YC-西元年-三位流水號（例：KHH-YC-2024-001），目前是「{eid}」")
        elif start and int(m.group(1)) != start.year:
            w("活動編號", f"編號年份 {m.group(1)} 與開始日期 {start.year} 不同")
        if eid in ids:
            e("活動編號", f"與第 {ids[eid]} 列重複，全檔要唯一")
        else:
            ids[eid] = n
    if r.get("活動類型") and r["活動類型"] not in EVENT_TYPES:
        e("活動類型", f"只能是：{'／'.join(sorted(EVENT_TYPES))}")
    if r.get("範圍判定") and r["範圍判定"] not in SCOPES:
        e("範圍判定", "只能是「核心」或「周邊」")
    names = [x.strip() for x in r.get("來源名稱", "").split("|")] if r.get("來源名稱") else []
    types = [x.strip() for x in r.get("來源類型", "").split("|")] if r.get("來源類型") else []
    urls = [x.strip() for x in r.get("來源網址", "").split("|")] if r.get("來源網址") else []
    if types and any(t not in SOURCE_TYPES for t in types):
        e("來源類型", f"只能是：{'／'.join(sorted(SOURCE_TYPES))}（多個用「 | 」分隔）")
    if names and types and len(types) != len(names):
        e("來源類型", f"有 {len(types)} 個，來源名稱有 {len(names)} 個，筆數要一樣")
    if names and urls and len(urls) != len(names):
        e("來源網址", f"有 {len(urls)} 個，來源名稱有 {len(names)} 個，筆數要一樣")
    bad_urls = [u for u in urls if not URL.match(u)]
    if bad_urls:
        e("來源網址", f"不是完整的 http(s) 網址：{bad_urls[0]}")
    count = r.get("佐證來源數", "")
    if count:
        if not re.fullmatch(r"[1-9]\d*", count):
            e("佐證來源數", "要是正整數")
        elif urls and int(count) != len(urls):
            e("佐證來源數", f"是 {count}，但來源網址有 {len(urls)} 個")
    trust = r.get("資料可信度", "")
    if trust and trust not in TRUST:
        e("資料可信度", "只能是「高」「中」「低」")
    elif trust in ("中", "低") and not r.get("備註", "").strip():
        e("備註", f"可信度為「{trust}」時一定要寫原因")
    elif trust == "高" and len(urls) < 2 and not any(t == "官方公告" for t in types):
        w("資料可信度", "「高」需要官方來源或 2 個以上來源一致")
    got = r.get("擷取日期", "")
    if got:
        d = parse_date(got)
        if not d:
            e("擷取日期", f"日期格式要是 YYYY-MM-DD（目前是「{got}」）")
        elif d > today:
            e("擷取日期", "不可晚於今天")
    return start


def grade(path, config):
    rep = Report()
    name = os.path.basename(path)
    if name.lower().endswith(".xlsx"):
        try:
            _, rows = read_xlsx(path)
        except Exception as ex:  # noqa: BLE001
            return {"passed": False, "score": None, "message": f"讀不到這個 XLSX：{ex}"}
    elif name.lower().endswith(".csv"):
        rows, err = read_csv(path)
        if err:
            return {"passed": False, "score": None, "message": err}
    else:
        return {"passed": False, "score": None, "message": "請上傳 .csv 或 .xlsx"}

    rows = [[c.strip() if isinstance(c, str) else c for c in r] for r in rows]
    if not rows:
        return {"passed": False, "score": None, "message": "檔案是空的"}
    header, body = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]
    missing = [c for c in COLUMNS if c not in header]
    if missing:
        rep.add("error", "表頭", f"缺少欄位：{'、'.join(missing)}（欄位只能多不能少）")
    if header[:5] != REQUIRED:
        rep.add("error", "表頭", f"前 5 欄必須依序是：{'、'.join(REQUIRED)}（目前是 {'、'.join(header[:5])}）")
    if missing:
        return finish(rep, len(body), header_ok=False)
    idx = {c: header.index(c) for c in COLUMNS}

    today = dt.date.today()
    ids = {}
    years = set()
    for n, r in enumerate(body, 1):
        cells = {c: (r[i] if i < len(r) else "") for c, i in idx.items()}
        start = check_row(rep, n, cells, ids, today)
        if start:
            years.add(start.year)

    lo, hi = parse_date(config.get("from", "")), parse_date(config.get("to", ""))
    if lo and hi:
        for y in range(lo.year, hi.year + 1):
            if y not in years:
                rep.add("warning", "年份", f"{y} 年沒有任何活動資料：確認真的沒有，或在留言寫查過哪些來源")
    return finish(rep, len(body))


def finish(rep, n_rows, header_ok=True):
    good = n_rows - len(rep.bad_rows) if header_ok else 0
    score = round(100 * good / n_rows, 1) if n_rows else 0.0
    # Errors first; keep the result under the platform's detail limit.
    items = sorted(rep.items, key=lambda d: (d["level"] != "error", d.get("row", 0)))
    shown = items[:MAX_DETAILS]
    head = f"ERROR {rep.errors}｜WARNING {rep.warnings}｜{n_rows} 筆資料" + (f"，{good} 筆沒有錯誤" if header_ok else "，表頭不對所以沒有逐列檢查")
    if len(items) > len(shown):
        head += f"（只列出前 {len(shown)} 項）"
    if rep.errors:
        return {"passed": False, "score": score, "message": f"{head}。ERROR 要是 0 才算通過", "details": shown}
    return {"passed": True, "score": score, "message": head, "details": shown or [{"name": "格式檢查", "passed": True, "message": "全部通過"}]}


def main():
    args = sys.argv[1:]
    config = {}
    if args and args[0] == "--file":
        path = args[1]
        for k in ("from", "to"):
            if f"--{k}" in args:
                config[k] = args[args.index(f"--{k}") + 1]
        r = grade(path, config)
        print(r["message"])
        for d in r.get("details", []):
            where = f"第 {d['row']} 列 {d.get('column', '')}" if "row" in d else d["name"]
            print(f"  [{d['level'].upper() if 'level' in d else 'OK'}] {where}：{d['message']}")
        sys.exit(0 if r["passed"] else 1)
    sub, data, out = args[0], args[1], args[2]
    cfg = os.path.join(data, "config.json")
    if os.path.exists(cfg):
        config = json.load(open(cfg, encoding="utf-8"))
    files = sorted(f for f in os.listdir(sub) if f.lower().endswith((".csv", ".xlsx")))
    if not files:
        r = {"passed": False, "score": None, "message": "找不到 .csv 或 .xlsx 檔"}
    else:
        r = grade(os.path.join(sub, files[0]), config)
    with open(os.path.join(out, "result.json"), "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
