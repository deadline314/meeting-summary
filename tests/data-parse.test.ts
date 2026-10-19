import { describe, expect, it } from 'vitest'
import { decode, distinct, parseCsv, parseTable, profile, sniffDelimiter, toCsv } from '../src/client/features/data/parse'

const enc = new TextEncoder()

/** A minimal XLSX (deflated entries, like Excel writes) built in the test. */
async function xlsx(files: Record<string, string>) {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text)
    const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const n = enc.encode(name)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(8, 8, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, raw.length, true)
    local.setUint16(26, n.length, true)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(10, 8, true)
    dir.setUint32(20, data.length, true)
    dir.setUint32(24, raw.length, true)
    dir.setUint16(28, n.length, true)
    dir.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), n, data)
    central.push(new Uint8Array(dir.buffer), n)
    offset += 30 + n.length + data.length
  }
  const size = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, Object.keys(files).length, true)
  end.setUint16(10, Object.keys(files).length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  return new Uint8Array(await new Blob([...parts, ...central, new Uint8Array(end.buffer)] as Uint8Array<ArrayBuffer>[]).arrayBuffer())
}

describe('data viewer parsing', () => {
  it('parses quoted CSV with commas, newlines and doubled quotes; sniffs the delimiter', () => {
    const text = 'a,b,c\r\n1,"x, y","say ""hi"""\n2,"line1\nline2",\n'
    expect(parseCsv(text)).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['2', 'line1\nline2', '']])
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('縣市,區域,活動名稱\n高雄市,鹽埕區,燈會')).toBe(',')
  })

  it('reads UTF-8 (with BOM) and falls back to Big5', () => {
    expect(decode(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('高雄市')]))).toEqual({ text: '高雄市', encoding: 'utf-8' })
    // "高雄" in Big5.
    expect(decode(new Uint8Array([0xb0, 0xaa, 0xb6, 0xaf]))).toEqual({ text: '高雄', encoding: 'big5' })
  })

  it('builds a sheet: header width wins, empty rows dropped, profiles by type', async () => {
    const p = await parseTable(enc.encode('id,city,date,n\n1,高雄市,2024-01-27,3\n\n2,高雄市,2024-02-01 ~ 2024-02-03,\n3,臺北市,2023-07-01,10\n'), 'x.csv')
    const s = p.sheets[0]!
    expect(p.encoding).toBe('utf-8')
    expect(s.header).toEqual(['id', 'city', 'date', 'n'])
    expect(s.rows).toHaveLength(3)
    expect(profile(s.rows, 0)).toMatchObject({ type: 'number', filled: 3, min: '1', max: '3' })
    expect(profile(s.rows, 1)).toMatchObject({ type: 'text', unique: 2, top: [['高雄市', 2], ['臺北市', 1]] })
    expect(profile(s.rows, 2)).toMatchObject({ type: 'date', min: '2023-07-01' })
    expect(profile(s.rows, 3)).toMatchObject({ type: 'number', empty: 1, max: '10' })
    expect(distinct(s.rows, 1)).toEqual([['高雄市', 2], ['臺北市', 1]])
  })

  it('reads XLSX: shared and inline strings, sparse cells, several sheets', async () => {
    const book = await xlsx({
      'xl/workbook.xml': '<workbook><sheets><sheet name="events" sheetId="1" r:id="rId1"/><sheet name="欄位規格" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>縣市</t></si><si><r><t>區</t></r><r><t>域</t></r></si><si><t>高雄市</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>數量 &amp; 備註</t></is></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>42</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>#</t></is></c></row></sheetData></worksheet>',
    })
    const p = await parseTable(book, 'sample.xlsx')
    expect(p.sheets.map((s) => s.name)).toEqual(['events', '欄位規格'])
    expect(p.sheets[0]!.header).toEqual(['縣市', '區域', '數量 & 備註'])
    expect(p.sheets[0]!.rows).toEqual([['高雄市', '', '42']])
  })

  it('exports CSV that Excel reads as UTF-8', () => {
    expect(toCsv(['a', 'b'], [['1', 'x, "y"']])).toBe('﻿a,b\r\n1,"x, ""y"""\r\n')
  })
})
