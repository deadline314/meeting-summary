import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Calendar, Check, Columns3, Copy, Download, Filter, Hash, ListFilter, Search, Type, X, XCircle } from 'lucide-react'
import { Popover } from 'radix-ui'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDebounced } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { fileUrl } from '../../lib/upload'
import { Button, IconButton } from '../../ui/button'
import { copyText } from '../../ui/context-menu'
import { Dialog } from '../../ui/dialog'
import { cx } from '../../ui/cx'
import { Input, Select } from '../../ui/field'
import { Badge, EmptyState, Skeleton } from '../../ui/misc'
import { TabBar } from '../../ui/tabs'
import { distinct, toCsv, type ColumnType, type Profile, type Sheet } from './parse'
import type { WorkerResult } from './worker'

/** A grader finding located in the file (MS-55): 1-based data row, optional column name. */
export type Finding = { row: number; column?: string; level: 'error' | 'warning'; message: string }

type Filter =
  | { col: number; kind: 'values'; mode: 'include' | 'exclude'; values: string[] }
  | { col: number; kind: 'blank' | 'filled' }
  | { col: number; kind: 'contains'; text: string }

const ROW_H = 36
/** More than the rows that can be on screen at once, plus the margin above and below. */
const POOL = 128

/** Rough rendered width at 13px: CJK and full-width characters take about twice the room. */
function textWidth(s: string) {
  let w = 0
  for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 13.5 : 7.4
  return w
}
const NUM_W = 56
const panel = 'anim-pop z-[70] rounded-xl border border-line bg-surface p-1.5 shadow-card'

/** Downloads once per file (cached), parses in a worker. */
function useTable(id: string, name: string) {
  return useQuery({
    queryKey: ['table', id],
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(fileUrl(id))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      try {
        const out = await new Promise<WorkerResult>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<WorkerResult>) => resolve(e.data)
          worker.onerror = (e) => reject(new Error(e.message))
          worker.postMessage({ buf, name }, [buf])
        })
        if (!out.ok) throw new Error(out.error)
        return out
      } finally {
        worker.terminate()
      }
    },
  })
}

const TYPE_ICON: Record<ColumnType, ReactNode> = { number: <Hash />, date: <Calendar />, text: <Type />, empty: <Type /> }

export function DataViewer({ file, findings = [], focusRow }: { file: { id: string; name: string; size?: number }; findings?: Finding[]; focusRow?: number }) {
  const { t, fmt } = useI18n()
  const q = useTable(file.id, file.name)
  const [sheetIdx, setSheet] = useState(0)
  const [tab, setTab] = useState<'data' | 'columns'>('data')
  if (q.isPending)
    return (
      <div className="flex flex-col gap-3 p-1">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-[50vh]" />
      </div>
    )
  if (q.isError)
    return <EmptyState className="py-16" icon={<XCircle />} title={t('data.parseFailed')} hint={t('data.parseFailedHint', { reason: q.error.message })} />
  const { parsed, profiles } = q.data
  const sheet = parsed.sheets[Math.min(sheetIdx, parsed.sheets.length - 1)]!
  const prof = profiles[Math.min(sheetIdx, profiles.length - 1)]!
  const DELIM: Record<string, MsgKey> = { ',': 'data.delim.comma', '\t': 'data.delim.tab', ';': 'data.delim.semicolon', '|': 'data.delim.pipe' }
  const delimiterName = parsed.delimiter ? t(DELIM[parsed.delimiter] ?? 'data.delim.comma') : null
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* What the file is, at a glance. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-3">
        {file.size !== undefined && <span>{fmt.bytes(file.size)}</span>}
        <span>
          <b className="font-semibold text-fg">{fmt.number(sheet.rows.length)}</b> {t('data.rows')}
        </span>
        <span>
          <b className="font-semibold text-fg">{sheet.header.length}</b> {t('data.columns')}
        </span>
        {parsed.encoding && <Badge tone={parsed.encoding === 'utf-8' ? 'neutral' : 'warning'}>{parsed.encoding === 'utf-8' ? 'UTF-8' : t('data.notUtf8')}</Badge>}
        {delimiterName && <span>{t('data.delimiter', { d: delimiterName })}</span>}
        {sheet.truncated && <Badge tone="warning">{t('data.truncated', { n: fmt.number(sheet.rows.length) })}</Badge>}
        {parsed.sheets.length > 1 && (
          <Select value={sheetIdx} onChange={(e) => setSheet(Number(e.target.value))} aria-label={t('data.sheet')} className="h-8 w-auto text-xs">
            {parsed.sheets.map((s, i) => (
              <option key={i} value={i}>
                {s.name}（{s.rows.length}）
              </option>
            ))}
          </Select>
        )}
      </div>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'data', label: t('data.tab.data') },
          { value: 'columns', label: t('data.tab.columns') },
        ]}
      />
      {/* Keyed by sheet so filters and sort start fresh on another sheet. */}
      {tab === 'data' ? (
        <Table key={sheetIdx} sheet={sheet} profiles={prof} findings={sheetIdx === 0 ? findings : []} fileName={file.name} focusRow={focusRow} />
      ) : (
        <ColumnsOverview sheet={sheet} profiles={prof} findings={sheetIdx === 0 ? findings : []} />
      )}
    </div>
  )
}

const label = (h: string, i: number, t: (k: MsgKey, p?: Record<string, string | number>) => string) => h || t('data.col', { n: i + 1 })

function ColumnsOverview({ sheet, profiles, findings }: { sheet: Sheet; profiles: Profile[]; findings: Finding[] }) {
  const { t, fmt } = useI18n()
  const issues = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of findings) if (f.column) m.set(f.column, (m.get(f.column) ?? 0) + 1)
    return m
  }, [findings])
  const n = sheet.rows.length || 1
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-fg-3">
          <tr>
            {['data.c.name', 'data.c.type', 'data.c.filled', 'data.c.unique', 'data.c.range', 'data.c.top'].map((k) => (
              <th key={k} className="px-3 py-2 font-medium whitespace-nowrap">
                {t(k as MsgKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sheet.header.map((h, i) => {
            const p = profiles[i]!
            const bad = issues.get(h)
            return (
              <tr key={i} className="align-top">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  <span className="mr-1.5 font-mono text-[11px] text-fg-4">{i + 1}</span>
                  {label(h, i, t)}
                  {!!bad && (
                    <Badge tone="danger" className="ml-2">
                      {t('data.issuesN', { n: bad })}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-fg-3 [&_svg]:mr-1 [&_svg]:inline [&_svg]:size-3.5">
                  {TYPE_ICON[p.type]}
                  {t(`data.type.${p.type}` as MsgKey)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full bg-accent" style={{ width: `${(p.filled / n) * 100}%` }} />
                    </div>
                    <span className="text-fg-3">
                      {fmt.number(p.filled)}
                      {p.empty > 0 && <span className="text-fg-4">（{t('data.blankN', { n: fmt.number(p.empty) })}）</span>}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-fg-3">{fmt.number(p.unique)}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-fg-3">{p.min !== undefined ? `${p.min} – ${p.max}` : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex max-w-[28rem] flex-wrap gap-1">
                    {p.top.map(([v, c]) => (
                      <span key={v} className="inline-flex max-w-56 items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs">
                        <span className="truncate">{v}</span>
                        <span className="text-fg-4">{c}</span>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Table({ sheet, profiles, findings, fileName, focusRow }: { sheet: Sheet; profiles: Profile[]; findings: Finding[]; fileName: string; focusRow?: number }) {
  const { t, fmt } = useI18n()
  const { header, rows } = sheet
  const [qText, setQ] = useState('')
  const q = useDebounced(qText.trim().toLowerCase(), 120)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [filters, setFilters] = useState<Filter[]>([])
  const [issueView, setIssueView] = useState<'all' | 'issues' | 'errors'>('all')
  const [selected, setSelected] = useState<number | null>(focusRow !== undefined ? focusRow - 1 : null)

  // Findings by cell ("row:col") and by row, for highlighting and the issue filter.
  const marks = useMemo(() => {
    const byCell = new Map<string, Finding[]>()
    const byRow = new Map<number, Finding[]>()
    const colOf = new Map(header.map((h, i) => [h, i]))
    for (const f of findings) {
      const r = f.row - 1
      byRow.set(r, [...(byRow.get(r) ?? []), f])
      const c = f.column !== undefined ? colOf.get(f.column) : undefined
      if (c !== undefined) byCell.set(`${r}:${c}`, [...(byCell.get(`${r}:${c}`) ?? []), f])
    }
    return { byCell, byRow }
  }, [findings, header])

  const visibleCols = useMemo(() => header.map((_, i) => i).filter((i) => !hidden.has(i)), [header, hidden])

  // Rows that pass every filter, then sorted. Plain loops over arrays: ~10 ms for 10k × 20.
  const view = useMemo(() => {
    const tests = filters.map((f) => {
      if (f.kind === 'values') {
        const set = new Set(f.values)
        return f.mode === 'include' ? (r: string[]) => set.has(r[f.col] ?? '') : (r: string[]) => !set.has(r[f.col] ?? '')
      }
      if (f.kind === 'blank') return (r: string[]) => !(r[f.col] ?? '').trim()
      if (f.kind === 'filled') return (r: string[]) => !!(r[f.col] ?? '').trim()
      if (f.kind !== 'contains') return () => true
      const needle = f.text.toLowerCase()
      return (r: string[]) => (r[f.col] ?? '').toLowerCase().includes(needle)
    })
    const out: number[] = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!
      if (issueView !== 'all') {
        const m = marks.byRow.get(i)
        if (!m || (issueView === 'errors' && !m.some((f) => f.level === 'error'))) continue
      }
      if (!tests.every((fn) => fn(r))) continue
      if (q && !visibleCols.some((c) => (r[c] ?? '').toLowerCase().includes(q))) continue
      out.push(i)
    }
    if (sort) {
      const numeric = profiles[sort.col]?.type === 'number'
      const c = sort.col
      out.sort((a, b) => {
        const x = rows[a]![c] ?? ''
        const y = rows[b]![c] ?? ''
        // Blanks always last.
        if (!x !== !y) return x ? -1 : 1
        const d = numeric ? Number(x) - Number(y) : x.localeCompare(y, 'zh-Hant')
        return d * sort.dir || a - b
      })
    }
    return out
  }, [rows, filters, q, visibleCols, sort, profiles, issueView, marks])

  // Column widths from the header (plus its icons and filter button) and a sample of values.
  const widths = useMemo(
    () =>
      header.map((h, i) => {
        let w = textWidth(label(h, i, t)) + 108
        for (let k = 0; k < Math.min(rows.length, 300); k++) w = Math.max(w, Math.min(textWidth(rows[k]![i] ?? ''), 300) + 24)
        return Math.round(Math.min(340, Math.max(96, w)))
      }),
    [header, rows, t],
  )
  const totalW = NUM_W + visibleCols.reduce((s, c) => s + widths[c]!, 0)

  // Virtual scrolling: only the rows in view (plus a margin) are in the DOM.
  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, h: 600 })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setScroll({ top: el.scrollTop, h: el.clientHeight }))
    }
    on()
    el.addEventListener('scroll', on, { passive: true })
    const ro = new ResizeObserver(on)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', on)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])
  // Jump to a row asked for from outside (a finding in the submission card), and to its first marked cell.
  useEffect(() => {
    const el = scroller.current
    if (focusRow === undefined || !el) return
    const pos = view.indexOf(focusRow - 1)
    if (pos >= 0) el.scrollTop = Math.max(0, pos * ROW_H - ROW_H * 3)
    const col = header.indexOf(marks.byRow.get(focusRow - 1)?.find((f) => f.column)?.column ?? '')
    const at = visibleCols.indexOf(col)
    if (at >= 0) {
      const left = NUM_W + visibleCols.slice(0, at).reduce((s, c) => s + widths[c]!, 0)
      el.scrollLeft = Math.max(0, left - NUM_W - 24)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRow])
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 8)
  const last = Math.min(view.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + 8)

  const setFilter = useCallback((col: number, f: Filter | null) => setFilters((fs) => [...fs.filter((x) => x.col !== col), ...(f ? [f] : [])]), [])
  // Stable callbacks so scrolling (which re-renders this component) never re-renders the header.
  const cycleSort = useCallback((c: number) => setSort((s) => (s?.col !== c ? { col: c, dir: 1 } : s.dir === 1 ? { col: c, dir: -1 } : null)), [])
  const hideCol = useCallback((c: number) => setHidden((h) => new Set(h).add(c)), [])
  const exportCsv = () => {
    const blob = new Blob([toCsv(visibleCols.map((c) => header[c]!), view.map((i) => visibleCols.map((c) => rows[i]![c] ?? '')))], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${fileName.replace(/\.(csv|tsv|xlsx)$/i, '')}-${t('data.exportSuffix')}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const errors = findings.filter((f) => f.level === 'error').length
  const warnings = findings.length - errors
  const dirty = !!(filters.length || q || hidden.size || sort || issueView !== 'all')

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1 md:max-w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
            <Input value={qText} onChange={(e) => setQ(e.target.value)} placeholder={t('data.search')} aria-label={t('data.search')} className="h-9 pl-9" />
          </div>
          <ColumnPicker header={header} hidden={hidden} onChange={setHidden} />
          {findings.length > 0 && (
            <Select value={issueView} onChange={(e) => setIssueView(e.target.value as typeof issueView)} aria-label={t('data.issueView')} className="h-9 w-auto">
              <option value="all">{t('data.issue.all')}</option>
              <option value="issues">{t('data.issue.rows', { n: marks.byRow.size })}</option>
              {errors > 0 && <option value="errors">{t('data.issue.errors', { n: errors })}</option>}
            </Select>
          )}
          <span className="text-xs text-fg-3" aria-live="polite">
            {t('data.matching', { n: fmt.number(view.length), total: fmt.number(rows.length) })}
          </span>
          <div className="flex-1" />
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => (setFilters([]), setQ(''), setHidden(new Set()), setSort(null), setIssueView('all'))}>
              {t('common.clearFilters')}
            </Button>
          )}
          <Button size="sm" icon={<Download className="size-4" />} onClick={exportCsv} disabled={!view.length}>
            {t('data.export')}
          </Button>
        </div>
        {(filters.length > 0 || findings.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {findings.length > 0 && (
              <span className="mr-1 inline-flex items-center gap-2 text-xs">
                {errors > 0 && <Badge tone="danger">{t('data.errorsN', { n: errors })}</Badge>}
                {warnings > 0 && <Badge tone="warning">{t('data.warningsN', { n: warnings })}</Badge>}
              </span>
            )}
            {filters.map((f) => (
              <span key={f.col} className="anim-rise inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pr-1 pl-2.5 text-xs text-accent-text">
                <b className="font-semibold">{label(header[f.col]!, f.col, t)}</b>
                {f.kind === 'values'
                  ? `${f.mode === 'include' ? t('data.f.only') : t('data.f.not')} ${f.values.slice(0, 2).map((v) => v || t('data.blank')).join('、')}${f.values.length > 2 ? ` +${f.values.length - 2}` : ''}`
                  : f.kind === 'contains'
                    ? t('data.f.containsX', { x: f.text })
                    : t(f.kind === 'blank' ? 'data.f.blank' : 'data.f.filled')}
                <button type="button" aria-label={t('common.delete')} onClick={() => setFilter(f.col, null)} className="rounded-full p-0.5 hover:bg-surface">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface" role="grid" aria-rowcount={view.length + 1} aria-colcount={visibleCols.length}>
          <div style={{ width: totalW, height: (view.length + 1) * ROW_H }} className="relative">
            {/* Header row: sticky to the top; the row-number corner also sticks left. */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface-2 text-xs font-medium text-fg-2" style={{ height: ROW_H, width: totalW }} role="row">
              <div className="sticky left-0 z-10 flex shrink-0 items-center justify-end border-r border-line bg-surface-2 px-2 text-fg-4" style={{ width: NUM_W }}>
                #
              </div>
              {visibleCols.map((c) => (
                <HeaderCell
                  key={c}
                  col={c}
                  name={label(header[c]!, c, t)}
                  width={widths[c]!}
                  type={profiles[c]?.type ?? 'text'}
                  sort={sort?.col === c ? sort.dir : 0}
                  onSort={cycleSort}
                  filter={filters.find((f) => f.col === c)}
                  onFilter={setFilter}
                  onHide={hideCol}
                  rows={rows}
                />
              ))}
            </div>
            {view.slice(first, last).map((ri, k) => (
              <Row
                // Keyed by screen slot, not by data row: rows scrolled out are reused for the ones
                // coming in (text updates instead of building new elements).
                key={(first + k) % POOL}
                top={(first + k + 1) * ROW_H}
                index={ri}
                row={rows[ri]!}
                cols={visibleCols}
                widths={widths}
                width={totalW}
                q={q}
                marks={marks}
                selected={selected === ri}
                onSelect={setSelected}
              />
            ))}
          </div>
          {!view.length && (
            <div className="absolute inset-x-0 top-24">
              <EmptyState icon={<ListFilter />} title={t('data.noMatch')} />
            </div>
          )}
        </div>
      </div>
      {selected !== null && rows[selected] && (
        <RowDetail header={header} row={rows[selected]} index={selected} findings={marks.byRow.get(selected) ?? []} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

const Row = memo(function Row({
  top,
  index,
  row,
  cols,
  widths,
  width,
  q,
  marks,
  selected,
  onSelect,
}: {
  top: number
  index: number
  row: string[]
  cols: number[]
  widths: number[]
  width: number
  q: string
  marks: { byCell: Map<string, Finding[]>; byRow: Map<number, Finding[]> }
  selected: boolean
  onSelect(i: number): void
}) {
  const rowMarks = marks.byRow.get(index)
  const rowLevel = rowMarks?.some((f) => f.level === 'error') ? 'error' : rowMarks?.length ? 'warning' : null
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      onClick={() => onSelect(index)}
      className={cx('absolute left-0 flex cursor-pointer border-b border-line text-[13px] hover:bg-surface-2', selected && 'bg-accent-soft hover:bg-accent-soft')}
      style={{ top, height: ROW_H, width, contain: 'strict' }}
    >
      <div
        className={cx(
          'sticky left-0 z-10 flex shrink-0 items-center justify-end gap-1 border-r border-line px-2 font-mono text-[11px] text-fg-4',
          selected ? 'bg-accent-soft' : 'bg-surface',
          rowLevel === 'error' && 'text-danger',
          rowLevel === 'warning' && 'text-warning',
        )}
        style={{ width: NUM_W }}
      >
        {rowLevel && <AlertTriangle className="size-3" />}
        {index + 1}
      </div>
      {cols.map((c) => {
        const v = row[c] ?? ''
        const m = marks.byCell.get(`${index}:${c}`)
        const level = m?.some((f) => f.level === 'error') ? 'error' : m ? 'warning' : null
        return (
          <div
            key={c}
            role="gridcell"
            title={m ? m.map((f) => f.message).join('\n') : v.length > 40 ? v : undefined}
            className={cx(
              'flex shrink-0 items-center overflow-hidden border-r border-line px-2.5',
              level === 'error' && 'bg-danger-soft text-danger',
              level === 'warning' && 'bg-warning-soft text-warning',
            )}
            style={{ width: widths[c] }}
          >
            <span className="truncate">{v ? <Highlight text={v} q={q} /> : <span className="text-fg-4">—</span>}</span>
          </div>
        )
      })}
    </div>
  )
})

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warning-soft text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

const HeaderCell = memo(function HeaderCell({
  col,
  name,
  width,
  type,
  sort,
  onSort,
  filter,
  onFilter,
  onHide,
  rows,
}: {
  col: number
  name: string
  width: number
  type: ColumnType
  sort: 0 | 1 | -1
  onSort(col: number): void
  filter?: Filter
  onFilter(col: number, f: Filter | null): void
  onHide(col: number): void
  rows: string[][]
}) {
  const { t } = useI18n()
  return (
    <div role="columnheader" aria-sort={sort === 1 ? 'ascending' : sort === -1 ? 'descending' : 'none'} className="group flex shrink-0 items-center gap-1 border-r border-line pr-1 pl-2.5" style={{ width }}>
      <button type="button" onClick={() => onSort(col)} title={t('data.sortHint')} className="flex min-w-0 flex-1 items-center gap-1.5 text-left [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-fg-4">
        {TYPE_ICON[type]}
        <span className="truncate">{name}</span>
        {sort === 1 ? <ArrowUp className="!text-accent-text" /> : sort === -1 ? <ArrowDown className="!text-accent-text" /> : <ArrowUpDown className="opacity-0 group-hover:opacity-100" />}
      </button>
      <ValueFilter col={col} name={name} filter={filter} onChange={(f) => onFilter(col, f)} onHide={() => onHide(col)} rows={rows} />
    </div>
  )
})

/** Per-column filter: pick values (only these / all but these), blank / not blank, or contains. */
function ValueFilter({ col, name, filter, onChange, onHide, rows }: { col: number; name: string; filter?: Filter; onChange(f: Filter | null): void; onHide(): void; rows: string[][] }) {
  const { t, fmt } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const values = useMemo(() => (open ? distinct(rows, col) : []), [open, rows, col])
  const picked = new Set(filter?.kind === 'values' ? filter.values : [])
  const mode = filter?.kind === 'values' ? filter.mode : 'include'
  const shown = values.filter(([v]) => !search || v.toLowerCase().includes(search.toLowerCase()))
  const toggle = (v: string) => {
    const next = new Set(picked)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(next.size ? { col, kind: 'values', mode, values: [...next] } : null)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton
          label={t('data.filterColumn', { name })}
          icon={<Filter />}
          size="sm"
          className={cx('size-7 shrink-0', filter ? 'text-accent-text' : 'opacity-60 group-hover:opacity-100 max-md:opacity-100')}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content data-layer data-sheet align="end" sideOffset={6} collisionPadding={12} className={cx(panel, 'flex w-72 max-w-[calc(100vw-24px)] flex-col gap-1.5 max-md:w-auto max-md:max-w-none')}>
          <div className="px-1.5 pt-1 text-xs font-semibold text-fg-2">{name}</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-0.5 text-xs" role="radiogroup" aria-label={t('data.f.mode')}>
            {(['include', 'exclude'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => picked.size && onChange({ col, kind: 'values', mode: m, values: [...picked] })}
                className={cx('h-8 rounded-md font-medium transition-colors', mode === m ? 'bg-surface text-fg shadow-sm' : 'text-fg-3')}
              >
                {t(m === 'include' ? 'data.f.only' : 'data.f.not')}
              </button>
            ))}
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('data.f.searchValues')} aria-label={t('data.f.searchValues')} className="h-8 text-xs" autoFocus />
          <div className="max-h-60 overflow-y-auto">
            {shown.slice(0, 300).map(([v, n]) => (
              <button key={v} type="button" onClick={() => toggle(v)} className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs hover:bg-surface-2 max-md:min-h-11">
                <span className={cx('flex size-4 shrink-0 items-center justify-center rounded border', picked.has(v) ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong')}>
                  {picked.has(v) && <Check className="size-3" />}
                </span>
                <span className={cx('min-w-0 flex-1 truncate', !v && 'text-fg-4 italic')}>{v || t('data.blank')}</span>
                <span className="text-fg-4">{fmt.number(n)}</span>
              </button>
            ))}
            {shown.length > 300 && <div className="px-1.5 py-1 text-[11px] text-fg-4">{t('data.f.more', { n: shown.length - 300 })}</div>}
          </div>
          <div className="flex flex-wrap gap-1 border-t border-line pt-1.5">
            <Button size="sm" variant={filter?.kind === 'blank' ? 'soft' : 'ghost'} onClick={() => onChange(filter?.kind === 'blank' ? null : { col, kind: 'blank' })}>
              {t('data.f.blank')}
            </Button>
            <Button size="sm" variant={filter?.kind === 'filled' ? 'soft' : 'ghost'} onClick={() => onChange(filter?.kind === 'filled' ? null : { col, kind: 'filled' })}>
              {t('data.f.filled')}
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" icon={<Columns3 className="size-3.5" />} onClick={() => (setOpen(false), onHide())}>
              {t('data.hideColumn')}
            </Button>
          </div>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              const text = new FormData(e.currentTarget).get('contains')?.toString().trim()
              onChange(text ? { col, kind: 'contains', text } : null)
            }}
          >
            <Input name="contains" defaultValue={filter?.kind === 'contains' ? filter.text : ''} placeholder={t('data.f.contains')} aria-label={t('data.f.contains')} className="h-8 text-xs" />
            <Button size="sm" type="submit">
              {t('data.f.apply')}
            </Button>
          </form>
          {filter && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t('data.f.clear')}
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ColumnPicker({ header, hidden, onChange }: { header: string[]; hidden: Set<number>; onChange(h: Set<number>): void }) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const shown = header.map((h, i) => [i, label(h, i, t)] as const).filter(([, h]) => !search || h.toLowerCase().includes(search.toLowerCase()))
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant={hidden.size ? 'soft' : 'secondary'} icon={<Columns3 className="size-4" />}>
          {t('data.columnsBtn', { n: header.length - hidden.size, total: header.length })}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content data-layer data-sheet align="start" sideOffset={6} collisionPadding={12} className={cx(panel, 'flex w-64 max-w-[calc(100vw-24px)] flex-col gap-1.5 max-md:w-auto max-md:max-w-none')}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('data.findColumn')} aria-label={t('data.findColumn')} className="h-8 text-xs" autoFocus />
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => onChange(new Set())}>
              {t('data.showAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(new Set(header.map((_, i) => i)))}>
              {t('data.hideAll')}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {shown.map(([i, h]) => (
              <label key={i} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-surface-2 max-md:min-h-11">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={!hidden.has(i)}
                  onChange={() => {
                    const n = new Set(hidden)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    onChange(n)
                  }}
                />
                <span className="font-mono text-[11px] text-fg-4">{i + 1}</span>
                <span className="truncate">{h}</span>
              </label>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** One row, every column top to bottom: the easy way to read a wide table. */
function RowDetail({ header, row, index, findings, onClose }: { header: string[]; row: string[]; index: number; findings: Finding[]; onClose(): void }) {
  const { t } = useI18n()
  return (
    <aside className="anim-rise flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface max-lg:fixed max-lg:inset-x-2 max-lg:bottom-2 max-lg:z-[60] max-lg:max-h-[60dvh] max-lg:w-auto max-lg:shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex-1 text-sm font-semibold">{t('data.rowN', { n: index + 1 })}</span>
        <IconButton label={t('data.copyRow')} icon={<Copy />} size="sm" onClick={() => copyText(header.map((h, i) => `${h}\t${row[i] ?? ''}`).join('\n'), t('common.copied'))} />
        <IconButton label={t('common.close')} icon={<X />} size="sm" onClick={onClose} />
      </div>
      <dl className="flex-1 divide-y divide-line overflow-y-auto text-[13px]">
        {findings
          .filter((f) => !f.column)
          .map((f, i) => (
            <div key={`r${i}`} className={cx('px-3 py-2 text-xs', f.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
              {f.message}
            </div>
          ))}
        {header.map((h, i) => {
          const v = row[i] ?? ''
          const own = findings.filter((f) => f.column === h)
          return (
            <div key={i} className={cx('px-3 py-2', own.length > 0 && (own.some((f) => f.level === 'error') ? 'bg-danger-soft' : 'bg-warning-soft'))}>
              <dt className="mb-0.5 text-[11px] font-medium text-fg-4">{label(h, i, t)}</dt>
              <dd className="break-words whitespace-pre-wrap">{v ? <Linkified text={v} /> : <span className="text-fg-4">—</span>}</dd>
              {own.map((f, k) => (
                <dd key={k} className={cx('mt-1 text-xs', f.level === 'error' ? 'text-danger' : 'text-warning')}>
                  {f.message}
                </dd>
              ))}
            </div>
          )
        })}
      </dl>
    </aside>
  )
}

/** URLs become links (several are often joined with " | "). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s|]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-accent-text break-all underline-offset-2 hover:underline">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** The viewer in a large dialog (submission cards, attachment previews). */
export function DataViewerDialog({ file, findings, focusRow, onClose }: { file: { id: string; name: string; size?: number }; findings?: Finding[]; focusRow?: number; onClose(): void }) {
  const { t } = useI18n()
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="screen"
      title={file.name}
      footer={
        <Button icon={<Download className="size-4" />} onClick={() => (location.href = `${fileUrl(file.id)}?download=1`)}>
          {t('files.download')}
        </Button>
      }
    >
      <div className="flex h-[74vh] flex-col max-md:h-[74dvh]">
        <DataViewer file={file} findings={findings} focusRow={focusRow} />
      </div>
    </Dialog>
  )
}

/** Grader details that point at a row become findings for the viewer. */
export function findingsOf(details: { name: string; passed: boolean; message?: string; row?: number; column?: string; level?: 'error' | 'warning' }[] | null | undefined): Finding[] {
  return (details ?? [])
    .filter((d) => d.row !== undefined && (!d.passed || d.level === 'warning'))
    .map((d) => ({ row: d.row!, column: d.column, level: d.level ?? (d.passed ? 'warning' : 'error'), message: d.message ? `${d.name}：${d.message}` : d.name }))
}
