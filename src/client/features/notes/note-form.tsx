import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { useMe } from '../../lib/session'
import { Button, IconButton } from '../../ui/button'
import { Dialog } from '../../ui/dialog'
import { Field, Input } from '../../ui/field'
import { UserChips } from '../../ui/user-picker'

export type Absentee = { userId?: string; name?: string; reason?: string }
export type NoteFields = {
  title: string
  startsAt: number
  endsAt: number | null
  location: string
  recorderId: string
  attendeeIds: string[]
  absentees: Absentee[]
}

const toLocal = (ms: number) => {
  const d = new Date(ms)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
const fromLocal = (s: string) => (s ? new Date(s).getTime() : NaN)

export function defaultFields(meId: string): NoteFields {
  const start = new Date()
  start.setMinutes(start.getMinutes() < 30 ? 0 : 30, 0, 0)
  return {
    title: '',
    startsAt: start.getTime(),
    endsAt: start.getTime() + 3600_000,
    location: '',
    recorderId: meId,
    attendeeIds: [meId],
    absentees: [],
  }
}

/** Create/edit dialog for the structured meeting fields. */
export function NoteFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange(v: boolean): void
  initial?: NoteFields
  title: string
  submitLabel: string
  onSubmit(f: NoteFields): Promise<unknown>
}) {
  const me = useMe()
  const { t } = useI18n()
  const [f, setF] = useState<NoteFields>(() => initial ?? defaultFields(me.id))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof NoteFields>(k: K, v: NoteFields[K]) => setF((x) => ({ ...x, [k]: v }))
  const valid = f.title.trim() && Number.isFinite(f.startsAt)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit({ ...f, title: f.title.trim() })
              } finally {
                setBusy(false)
              }
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
        }}
      >
        <Field label={t('notes.field.title')}>
          {(id) => <Input id={id} autoFocus value={f.title} maxLength={120} placeholder={t('notes.field.titlePh')} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('notes.field.start')}>
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={toLocal(f.startsAt)}
                onChange={(e) => {
                  const s = fromLocal(e.target.value)
                  const dur = f.endsAt ? f.endsAt - f.startsAt : 3600_000
                  setF((x) => ({ ...x, startsAt: s, endsAt: Number.isFinite(s) ? s + dur : x.endsAt }))
                }}
              />
            )}
          </Field>
          <Field label={t('notes.field.end')}>
            {(id) => <Input id={id} type="datetime-local" value={f.endsAt ? toLocal(f.endsAt) : ''} onChange={(e) => set('endsAt', fromLocal(e.target.value) || null)} />}
          </Field>
        </div>
        <Field label={t('notes.field.location')}>
          {(id) => <Input id={id} value={f.location} placeholder={t('notes.field.locationPh')} onChange={(e) => set('location', e.target.value)} />}
        </Field>
        <Field label={t('notes.field.recorder')}>{() => <UserChips single value={[f.recorderId]} onChange={(ids) => set('recorderId', ids[ids.length - 1] ?? me.id)} />}</Field>
        <Field label={t('notes.field.attendees')}>{() => <UserChips value={f.attendeeIds} onChange={(ids) => set('attendeeIds', ids)} />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg-2">{t('notes.field.absentees')}</span>
          {f.absentees.map((a, i) => (
            <div key={i} className="anim-rise flex gap-2">
              <Input
                value={a.name ?? ''}
                placeholder={t('auth.devName')}
                aria-label={t('auth.devName')}
                onChange={(e) => set('absentees', f.absentees.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                value={a.reason ?? ''}
                placeholder={t('notes.field.reason')}
                aria-label={t('notes.field.reason')}
                onChange={(e) => set('absentees', f.absentees.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))}
              />
              <IconButton label={t('common.delete')} icon={<X />} onClick={() => set('absentees', f.absentees.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="size-4" />} onClick={() => set('absentees', [...f.absentees, { name: '', reason: '' }])}>
            {t('notes.addAbsentee')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
