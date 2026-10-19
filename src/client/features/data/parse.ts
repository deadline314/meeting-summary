// Table parsing for the data viewer: CSV/TSV (UTF-8 or Big5) and XLSX, with no dependencies.
// Runs inside a Web Worker (see worker.ts), so nothing here touches the DOM.

export type Sheet = { name: string; header: string[]; rows: string[][]; truncated: boolean }
export type Parsed = { kind: 'csv' | 'xlsx'; encoding?: 'utf-8' | 'big5'; delimiter?: string; sheets: Sheet[] }

/** Rows past this are not loaded (the viewer says so and offers the download). */
export const MAX_ROWS = 200_000

export const isTable = (name: string) => /\.(csv|tsv|xlsx)$/i.test(name)

/** UTF-8 if the bytes are valid UTF-8 (BOM dropped), otherwise Big5 — what Excel saves on zh-TW Windows. */
export function decode(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'big5' } {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('big5').decode(body), encoding: 'big5' }
  }
}

/** The candidate that splits the first lines into the most, equally many, fields. */
export function sniffDelimiter(text: string, name = '') {
  if (/\.tsv$/i.test(name)) return '\t'
  const lines = text.split(/\r?\n/, 6).filter(Boolean)
  let best = ','
  let bestScore = 0
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => parseCsv(l, d, 1)[0]?.length ?? 0)
    const first = counts[0] ?? 0
    const consistent = counts.every((c) => c === first)
    const score = first > 1 ? first * (consistent ? 2 : 1) : 0
    if (score > bestScore) [best, bestScore] = [d, score]
  }
  return best
}

/** RFC 4180: quoted fields may hold delimiters, newlines and doubled quotes. */
export function parseCsv(text: string, d = ',', limit = Infinity): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let quoted = false
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      i++
    } else if (c === d) {
      row.push(field)
      field = ''
      i++
    } else if (c === '\n' || c === '\r') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      if (rows.length >= limit) return rows
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += c
      i++
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Header + rows, every row padded/trimmed to the header's width; fully empty rows dropped. */
export function toSheet(name: string, all: string[][]): Sheet {
  const [head = [], ...rest] = all
  const body = rest.filter((r) => r.some((v) => v.trim() !== ''))
  const width = Math.max(head.length, ...body.slice(0, 1000).map((r) => r.length))
  // Missing header cells stay empty; the viewer labels them by position.
  const header = Array.from({ length: width }, (_, i) => head[i]?.trim() ?? '')
  const truncated = body.length > MAX_ROWS
  const rows = (truncated ? body.slice(0, MAX_ROWS) : body).map((r) => (r.length === width ? r : Array.from({ length: width }, (_, i) => r[i] ?? '')))
  return { name, header, rows, truncated }
}

// ---------- XLSX ----------

/** Reads a ZIP's central directory and inflates the entries we ask for (native DecompressionStream). */
async function unzip(bytes: Uint8Array, want: (name: string) => boolean) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  const utf8 = new TextDecoder()
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory')
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name)) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + size)
    if (method === 0) out.set(name, raw)
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()))
  }
  return out
}

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (_, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'amp' ? '&' : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  )

/** Text of every <t> inside a fragment (rich text runs joined). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('')

/** "BC12" → zero-based column 54. */
function colIndex(ref: string) {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const files = await unzip(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const dec = new TextDecoder()
  const read = (n: string) => (files.has(n) ? dec.decode(files.get(n)) : '')
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!))
  const rels = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]))
  const sheets: Sheet[] = []
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? `Sheet${sheets.length + 1}`)
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1]
    const target = (rels.get(rid) ?? '').replace(/^\/?(xl\/)?/, '')
    const xml = read(`xl/${target}`)
    if (!xml) continue
    const rows: string[][] = []
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = []
      let next = 0
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!
        const body = c[2] ?? ''
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]
        const at = ref ? colIndex(ref) : next
        const t = /t="(\w+)"/.exec(attrs)?.[1]
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        const value = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? texts(body) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : unescapeXml(v ?? '')
        while (row.length < at) row.push('')
        row[at] = value
        next = at + 1
      }
      rows.push(row)
      if (rows.length > MAX_ROWS + 1) break
    }
    sheets.push(toSheet(name, rows))
  }
  if (!sheets.length) throw new Error('no worksheets')
  return sheets
}

export async function parseTable(bytes: Uint8Array, name: string): Promise<Parsed> {
  if (/\.xlsx$/i.test(name)) return { kind: 'xlsx', sheets: await readXlsx(bytes) }
  const { text, encoding } = decode(bytes)
  const delimiter = sniffDelimiter(text, name)
  return { kind: 'csv', encoding, delimiter, sheets: [toSheet(name, parseCsv(text, delimiter, MAX_ROWS + 2))] }
}

// ---------- column profile ----------

export type ColumnType = 'number' | 'date' | 'text' | 'empty'
export type Profile = { type: ColumnType; filled: number; empty: number; unique: number; top: [string, number][]; min?: string; max?: string }

const NUM = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/
const DATE = /^\d{4}-\d{2}-\d{2}( ~ \d{4}-\d{2}-\d{2})?$|^\d{4}\/\d{1,2}\/\d{1,2}$/

export function profile(rows: string[][], col: number): Profile {
  const counts = new Map<string, number>()
  let filled = 0
  let nums = 0
  let dates = 0
  let min: string | undefined
  let max: string | undefined
  for (const r of rows) {
    const v = (r[col] ?? '').trim()
    if (!v) continue
    filled++
    counts.set(v, (counts.get(v) ?? 0) + 1)
    if (NUM.test(v)) nums++
    else if (DATE.test(v)) dates++
  }
  const type: ColumnType = !filled ? 'empty' : nums === filled ? 'number' : dates + nums === filled && dates > 0 ? 'date' : 'text'
  if (type === 'number') {
    const vals = [...counts.keys()].map(Number)
    min = String(Math.min(...vals))
    max = String(Math.max(...vals))
  } else if (type === 'date') {
    const sorted = [...counts.keys()].sort()
    min = sorted[0]
    max = sorted[sorted.length - 1]
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  return { type, filled, empty: rows.length - filled, unique: counts.size, top, min, max }
}

/** Distinct values with counts, most common first (for the value filter). */
export function distinct(rows: string[][], col: number, limit = 1000) {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const v = r[col] ?? ''
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
}

/** CSV text (UTF-8 with BOM so Excel opens it right). */
export function toCsv(header: string[], rows: string[][]) {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'
}
