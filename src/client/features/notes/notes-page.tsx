import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTour } from '../../app/tour'
import { Link, useNavigate } from '@tanstack/react-router'
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, FileArchive, FileCode, FileText, Link2, List, MapPin, MessageSquareWarning, Plus, Search, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useActions } from '../../lib/actions'
import { api, queryClient } from '../../lib/api'
import { useDebounced } from '../../lib/hooks'
import { useI18n } from '../../lib/i18n'
import { AvatarStack, UserName } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Input, Select } from '../../ui/field'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../../ui/misc'
import { Segmented } from '../../ui/tabs'
import { ContextMenu, CtxItem, CtxLabel, CtxSeparator, copyText, openInNewTab, siteLink } from '../../ui/context-menu'
import { confirm } from '../../ui/dialog'
import { toast, toastError } from '../../ui/toast'
import { useDirectory, useMe } from '../../lib/session'
import { exportHtml, exportName, exportZip } from './export'
import { NoteFormDialog, type NoteFields } from './note-form'

export type NotesSearch = {
  q?: string
  from?: string
  to?: string
  recorderId?: string
  attendeeId?: string
  openComments?: boolean
  view?: 'list' | 'calendar'
  month?: string
  create?: boolean
  page?: number
}

type NoteRow = {
  id: string
  title: string
  startsAt: number
  location: string
  recorderId: string
  attendeeIds: string[]
  openComments: number
  snippet: string | null
  createdBy: string
}

const PAGE = 30

export function NotesPage({ search, setSearch }: { search: NotesSearch; setSearch(s: Partial<NotesSearch>): void }) {
  useTour('notes')
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const dir = useDirectory()
  const [q, setQ] = useState(search.q ?? '')
  const dq = useDebounced(q, 300)
  useEffect(() => {
    if (dq !== (search.q ?? '')) setSearch({ q: dq || undefined, page: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq])
  const view = search.view ?? 'list'
  const month = search.month ?? new Date().toISOString().slice(0, 7)
  const range = useMemo(() => {
    if (view === 'calendar') {
      const [y, m] = month.split('-').map(Number) as [number, number]
      return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() - 1 }
    }
    return { from: search.from ? new Date(search.from).getTime() : undefined, to: search.to ? new Date(search.to).getTime() + 86399_999 : undefined }
  }, [view, month, search.from, search.to])
  const page = search.page ?? 0
  const params = new URLSearchParams()
  if (search.q) params.set('q', search.q)
  if (range.from) params.set('from', String(range.from))
  if (range.to) params.set('to', String(range.to))
  if (search.recorderId) params.set('recorderId', search.recorderId)
  if (search.attendeeId) params.set('attendeeId', search.attendeeId)
  if (search.openComments) params.set('openComments', '1')
  params.set('offset', String(view === 'calendar' ? 0 : page * PAGE))
  params.set('limit', String(view === 'calendar' ? 200 : PAGE))
  const list = useQuery({
    queryKey: ['notes', params.toString()],
    queryFn: () => api<{ items: NoteRow[]; total: number }>(`/api/notes?${params}`),
    placeholderData: keepPreviousData,
  })
  const filtered = !!(search.q || search.from || search.to || search.recorderId || search.attendeeId || search.openComments)

  const create = async (f: NoteFields) => {
    try {
      const r = await api<{ note: { id: string } }>('/api/notes', { method: 'POST', body: f, headers: { 'x-locale': locale } })
      setSearch({ create: undefined })
      navigate({ to: `/notes/${r.note.id}` })
    } catch (err) {
      toastError(err)
    }
  }
  useActions([{ id: 'notes-new', label: 'action.newNote', keys: 'c', icon: <Plus />, group: 'group.create', run: () => setSearch({ create: true }) }])

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title={t('notes.title')}
        subtitle={t('notes.subtitle')}
        actions={
          <Button data-tour="notes-new" variant="primary" icon={<Plus className="size-4" />} onClick={() => setSearch({ create: true })} title={t('notes.newHint')}>
            {t('notes.new')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('notes.searchPh')} aria-label={t('common.search')} className="pl-9" />
        </div>
        <Segmented
          data-tour="notes-view"
          value={view}
          onChange={(v) => setSearch({ view: v === 'list' ? undefined : v })}
          options={[
            { value: 'list', label: t('notes.view.list'), icon: <List /> },
            { value: 'calendar', label: t('notes.view.calendar'), icon: <CalendarDays /> },
          ]}
        />
      </div>
      <div data-tour="notes-filters" className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        {view === 'list' && (
          <>
            <Input type="date" value={search.from ?? ''} onChange={(e) => setSearch({ from: e.target.value || undefined, page: undefined })} aria-label={t('notes.filter.from')} className="w-auto" />
            <span className="text-fg-4">–</span>
            <Input type="date" value={search.to ?? ''} onChange={(e) => setSearch({ to: e.target.value || undefined, page: undefined })} aria-label={t('notes.filter.to')} className="w-auto" />
          </>
        )}
        <Select value={search.recorderId ?? ''} onChange={(e) => setSearch({ recorderId: e.target.value || undefined, page: undefined })} aria-label={t('notes.filter.recorder')} className="w-auto">
          <option value="">{t('notes.filter.recorder')}</option>
          {[...dir.values()].map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select value={search.attendeeId ?? ''} onChange={(e) => setSearch({ attendeeId: e.target.value || undefined, page: undefined })} aria-label={t('notes.filter.attendee')} className="w-auto">
          <option value="">{t('notes.filter.attendee')}</option>
          {[...dir.values()].map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-fg-2 select-none hover:border-line-strong">
          <input type="checkbox" checked={!!search.openComments} onChange={(e) => setSearch({ openComments: e.target.checked || undefined, page: undefined })} className="accent-accent" />
          {t('notes.filter.openComments')}
        </label>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={() => (setQ(''), setSearch({ q: undefined, from: undefined, to: undefined, recorderId: undefined, attendeeId: undefined, openComments: undefined, page: undefined }))}>
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      {view === 'calendar' ? (
        <Calendar month={month} onMonth={(m) => setSearch({ month: m })} notes={list.data?.items ?? []} />
      ) : list.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : !list.data?.items.length ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={<Search />}
              title={t('notes.emptyFiltered')}
              action={
                <Button size="sm" onClick={() => (setQ(''), setSearch({ q: undefined, from: undefined, to: undefined, recorderId: undefined, attendeeId: undefined, openComments: undefined }))}>
                  {t('common.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<FileText />}
              title={t('notes.empty')}
              hint={t('notes.emptyHint')}
              action={
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setSearch({ create: true })}>
                  {t('notes.new')}
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {list.data.items.map((n, i) => (
              <motion.li key={n.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
                <NoteCard n={n} />
              </motion.li>
            ))}
          </ul>
          {list.data.total > PAGE && (
            <div className="mt-5 flex items-center justify-center gap-3 text-sm text-fg-3">
              <Button size="sm" disabled={page === 0} onClick={() => setSearch({ page: page - 1 || undefined })}>
                {t('common.prev')}
              </Button>
              {page + 1} / {Math.ceil(list.data.total / PAGE)}
              <Button size="sm" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setSearch({ page: page + 1 })}>
                {t('common.next')}
              </Button>
            </div>
          )}
        </>
      )}
      {search.create && (
        <NoteFormDialog open onOpenChange={(v) => !v && setSearch({ create: undefined })} title={t('notes.createTitle')} submitLabel={t('common.create')} onSubmit={create} />
      )}
    </div>
  )
}

/** Right-click on a note: open, link, export, delete (creator or staff). */
function NoteContextMenu({ n, children }: { n: NoteRow; children: React.ReactNode }) {
  const { t, locale } = useI18n()
  const me = useMe()
  const navigate = useNavigate()
  const path = `/notes/${n.id}`
  const run = async (kind: 'zip' | 'html') => {
    const strings = { attachments: t('export.attachments'), missing: t('export.missing'), source: t('export.source') }
    const base = exportName(n.title, n.startsAt)
    toast(t('export.started'), 'info')
    try {
      if (kind === 'zip') await exportZip(n.id, base, locale, strings, () => {})
      else await exportHtml(n.id, base, locale, n.title, strings, () => {})
      toast(t('export.done'))
    } catch (err) {
      toastError(err)
    }
  }
  return (
    <ContextMenu
      menu={
        <>
          <CtxLabel>{n.title}</CtxLabel>
          <CtxItem icon={<ChevronRight />} onSelect={() => navigate({ to: path })}>
            {t('ctx.open')}
          </CtxItem>
          <CtxItem icon={<ExternalLink />} onSelect={() => openInNewTab(path)}>
            {t('ctx.openNewTab')}
          </CtxItem>
          <CtxItem icon={<Link2 />} onSelect={() => copyText(siteLink(path), t('common.copied'))}>
            {t('pm.copyLink')}
          </CtxItem>
          <CtxSeparator />
          <CtxItem icon={<FileArchive />} onSelect={() => run('zip')}>
            {t('export.zip')}
          </CtxItem>
          <CtxItem icon={<FileCode />} onSelect={() => run('html')}>
            {t('export.html')}
          </CtxItem>
          {(n.createdBy === me.id || me.role !== 'student') && (
            <>
              <CtxSeparator />
              <CtxItem
                icon={<Trash2 />}
                danger
                onSelect={async () => {
                  if (!(await confirm({ title: `${t('common.delete')}「${n.title}」`, body: t('notes.deleteConfirm'), danger: true }))) return
                  try {
                    await api(`/api/notes/${n.id}`, { method: 'DELETE' })
                    toast(t('notes.deleted'))
                    queryClient.invalidateQueries({ queryKey: ['notes'] })
                  } catch (err) {
                    toastError(err)
                  }
                }}
              >
                {t('common.delete')}
              </CtxItem>
            </>
          )}
        </>
      }
    >
      {children}
    </ContextMenu>
  )
}

function NoteCard({ n }: { n: NoteRow }) {
  const { t, fmt } = useI18n()
  return (
    <NoteContextMenu n={n}>
    <Link
      to={`/notes/${n.id}`}
      className="group block rounded-2xl border border-line bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card"
    >
      <div className="flex items-start gap-3">
        <DateBadge ms={n.startsAt} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-fg group-hover:text-accent-text">{n.title}</h3>
            {n.openComments > 0 && (
              <Badge tone="warning">
                <MessageSquareWarning className="size-3" />
                {n.openComments}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-4">
            <span>{fmt.time(n.startsAt)}</span>
            {n.location && (
              <span className="flex max-w-56 items-center gap-1 truncate">
                <MapPin className="size-3 shrink-0" />
                {n.location}
              </span>
            )}
            <span>
              {t('notes.field.recorder')} <UserName id={n.recorderId} className="text-fg-3" />
            </span>
          </div>
          {n.snippet && <p className="mt-2 line-clamp-2 text-sm text-fg-3">{n.snippet}</p>}
        </div>
        <div className="hidden flex-col items-end gap-1 sm:flex">
          <AvatarStack ids={n.attendeeIds} max={4} />
          <span className="text-[11px] text-fg-4">{t('notes.attendeeCount', { n: n.attendeeIds.length })}</span>
        </div>
      </div>
    </Link>
    </NoteContextMenu>
  )
}

function DateBadge({ ms }: { ms: number }) {
  const { locale } = useI18n()
  const d = new Date(ms)
  return (
    <div className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-accent-soft py-1.5 text-accent-text">
      <span className="text-[10px] font-semibold uppercase">{d.toLocaleString(locale === 'zh' ? 'zh-TW' : 'en-US', { month: 'short' })}</span>
      <span className="text-lg leading-tight font-bold">{d.getDate()}</span>
    </div>
  )
}

function Calendar({ month, onMonth, notes }: { month: string; onMonth(m: string): void; notes: NoteRow[] }) {
  const { locale, t } = useI18n()
  const [y, m] = month.split('-').map(Number) as [number, number]
  const first = new Date(y, m - 1, 1)
  const days = new Date(y, m, 0).getDate()
  const lead = first.getDay()
  const byDay = new Map<number, NoteRow[]>()
  for (const n of notes) {
    const d = new Date(n.startsAt).getDate()
    byDay.set(d, [...(byDay.get(d) ?? []), n])
  }
  const shift = (k: number) => {
    const d = new Date(y, m - 1 + k, 1)
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 18 + i).toLocaleString(locale === 'zh' ? 'zh-TW' : 'en-US', { weekday: 'short' }))
  const today = new Date()
  const [sel, setSel] = useState<number | null>(null)
  return (
    <Card className="p-3 md:p-4">
      <div className="mb-3 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label={t('common.prev')}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-semibold">{first.toLocaleString(locale === 'zh' ? 'zh-TW' : 'en-US', { year: 'numeric', month: 'long' })}</span>
        <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label={t('common.next')}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-fg-4">
        {weekdays.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1
          const list = byDay.get(d) ?? []
          const isToday = today.getFullYear() === y && today.getMonth() === m - 1 && today.getDate() === d
          return (
            <button
              key={d}
              data-day={d}
              onClick={() => setSel(sel === d ? null : d)}
              className={cx(
                'flex min-h-14 flex-col items-stretch gap-0.5 rounded-xl border p-1 text-left transition-colors md:min-h-20',
                sel === d ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2',
              )}
            >
              <span className={cx('self-start rounded-full px-1.5 text-xs', isToday ? 'bg-accent font-bold text-accent-fg' : 'text-fg-3')}>{d}</span>
              {list.slice(0, 2).map((n) => (
                <span key={n.id} className="hidden truncate rounded-md bg-accent-soft px-1 text-[11px] text-accent-text md:block">
                  {n.title}
                </span>
              ))}
              {list.length > 0 && <span className="mx-auto size-1.5 rounded-full bg-accent md:hidden" />}
              {list.length > 2 && <span className="hidden text-[10px] text-fg-4 md:block">+{list.length - 2}</span>}
            </button>
          )
        })}
      </div>
      {sel && (
        <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          {(byDay.get(sel) ?? []).map((n) => (
            <li key={n.id}>
              <NoteCard n={n} />
            </li>
          ))}
          {!(byDay.get(sel) ?? []).length && <li className="py-4 text-center text-sm text-fg-4">{t('notes.empty')}</li>}
        </motion.ul>
      )}
    </Card>
  )
}
