import { ListTodo, SquareArrowOutUpRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { api, ApiError } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useDirectory } from '../../lib/session'
import { Button } from '../../ui/button'
import { Dialog } from '../../ui/dialog'
import { Field, Input, Select } from '../../ui/field'
import { toast, toastError } from '../../ui/toast'
import { canWrite, invalidateIssues, useProjects } from '../projects/model'
import { RefPill } from './ref-pill'

export type ActionRow = { line: string; item: string; owner: string; due: string; ref: string | null }

const HEADING = /^##\s*(五、|5\.\s*)?.*(待辦事項|action items)/i
const ISSUE_REF = /#\[issue:([A-Za-z]{2,6}-\d+)\]/

/** Rows of the "Action items" table (same rules as the server's carry-over), skipping placeholders. */
export function parseActionRows(md: string): ActionRow[] {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => HEADING.test(l.trim()))
  if (start < 0) return []
  const out: ActionRow[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    const l = line.trim()
    if (l.startsWith('#')) break
    if (!l.startsWith('|')) continue
    const cells = l.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 3 || cells.every((c) => /^:?-+:?$/.test(c)) || cells[0] === '#') continue
    const [, item = '', owner = '', due = ''] = cells.length >= 4 ? cells : ['', ...cells]
    if (!item || /^\[.*\]$/.test(item)) continue
    out.push({ line, item, owner, due, ref: ISSUE_REF.exec(item)?.[1] ?? null })
  }
  return out
}

/** "10/30", "2026/10/30" or "2026-10-30" → end of that day; a bare M/D more than ~6 months back means next year. */
export function parseDue(s: string, now = Date.now()): number | null {
  const full = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s)
  const short = /(^|\D)(\d{1,2})\/(\d{1,2})(\D|$)/.exec(s)
  const d = full ? new Date(+full[1]!, +full[2]! - 1, +full[3]!, 23, 59) : short ? new Date(new Date(now).getFullYear(), +short[2]! - 1, +short[3]!, 23, 59) : null
  if (!d || Number.isNaN(d.getTime())) return null
  if (!full && d.getTime() < now - 183 * 86400_000) d.setFullYear(d.getFullYear() + 1)
  return d.getTime()
}

/** Appends ` #[issue:REF]` after the item cell of `row` in the shared document, if the row is still there. */
function linkRow(text: Y.Text, row: ActionRow, ref: string) {
  const src = text.toString()
  const at = src.indexOf(row.line)
  if (at < 0) return false
  const itemEnd = row.line.indexOf(row.item) + row.item.length
  const bar = row.line.indexOf('|', itemEnd)
  if (bar < 0) return false
  text.insert(at + bar, `${row.line[bar - 1] === ' ' ? '' : ' '}#[issue:${ref}] `)
  return true
}

export function ActionItems({ text, source, canEdit, projectId }: { text: Y.Text; source: string; canEdit: boolean; projectId: string | null }) {
  const { t } = useI18n()
  const rows = useMemo(() => parseActionRows(source), [source])
  const [converting, setConverting] = useState<ActionRow | null>(null)
  if (!rows.length) return null
  return (
    <section className="flex flex-col gap-2 border-b border-line p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-fg-3">
        <ListTodo className="size-4" /> {t('actions.title')}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.line} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{r.item.replace(ISSUE_REF, '').trim()}</span>
            {r.ref ? (
              <RefPill type="issue" id={r.ref} />
            ) : (
              canEdit && (
                <Button size="sm" variant="ghost" icon={<SquareArrowOutUpRight className="size-3.5" />} onClick={() => setConverting(r)}>
                  {t('actions.toIssue')}
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
      {converting && <ConvertDialog row={converting} projectId={projectId} onClose={() => setConverting(null)} onDone={(ref) => (linkRow(text, converting, ref) ? toast(t('actions.linked', { ref })) : toast(t('actions.rowMoved'), 'info'), setConverting(null))} />}
    </section>
  )
}

function ConvertDialog({ row, projectId, onClose, onDone }: { row: ActionRow; projectId: string | null; onClose(): void; onDone(ref: string): void }) {
  const { t, fmt } = useI18n()
  const dir = useDirectory()
  const projects = useProjects()
  const targets = (projects.data ?? []).filter((p) => canWrite(p.role) && p.state === 'active')
  const [picked, setKey] = useState('')
  // Projects may still be loading on first render: default to the note's project, else the first one.
  const key = picked || (targets.find((p) => p.id === projectId)?.key ?? targets[0]?.key ?? '')
  const [title, setTitle] = useState(row.item)
  const [busy, setBusy] = useState(false)
  // Owner cell: an @[user:id] mention, or a display name that matches exactly.
  const ownerId = /@\[user:([\w-]+)\]/.exec(row.owner)?.[1] ?? [...dir.values()].find((u) => u.name === row.owner.trim())?.id
  const dueAt = parseDue(row.due)
  const submit = async () => {
    setBusy(true)
    const post = (assigneeIds: string[]) => api<{ issue: { ref: string } }>(`/api/projects/${key}/issues`, { method: 'POST', body: { title: title.trim(), assigneeIds, dueAt, operationId: crypto.randomUUID() } })
    try {
      let r
      try {
        r = await post(ownerId ? [ownerId] : [])
      } catch (err) {
        // The owner may not be a member of the chosen project: create it unassigned and say so.
        if (!(err instanceof ApiError && err.code === 'not_visible')) throw err
        r = await post([])
        toast(t('actions.ownerSkipped'), 'info')
      }
      invalidateIssues()
      onDone(r.issue.ref)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('actions.toIssue')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!key || !title.trim()} onClick={submit}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('issue.titlePh')}>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label={t('actions.project')}>
          {(id) => (
            <Select id={id} value={key} onChange={(e) => setKey(e.target.value)}>
              {targets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-4">{t('issue.assignees')}</dt>
          <dd>{ownerId ? dir.get(ownerId)?.name : row.owner || t('issue.none')}</dd>
          <dt className="text-fg-4">{t('issue.due')}</dt>
          <dd>{dueAt ? fmt.date(dueAt) : row.due || t('issue.none')}</dd>
        </dl>
      </div>
    </Dialog>
  )
}
