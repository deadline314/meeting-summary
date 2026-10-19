import { useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, FileCode2, FlaskConical, Rocket, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { renderMarkdown } from '../../lib/markdown'
import { compressImage, uploadFile } from '../../lib/upload'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { confirm } from '../../ui/dialog'
import { Field, Input, Select, Textarea } from '../../ui/field'
import { Badge, Card } from '../../ui/misc'
import { TabBar } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { useFiles } from '../files/files-panel'
import { Html } from '../notes/preview'
import { useSubmissions, type Task } from './model'
import { SubmissionCard } from './task-page'

type Section = 'basic' | 'grading' | 'rules' | 'publish'
const GRADING = ['graderFileId', 'dataFileId', 'image', 'requirements', 'timeoutSec', 'memoryMb'] as const

const toLocal = (ms: number | null) => {
  if (!ms) return ''
  const d = new Date(ms)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
const fromLocal = (s: string) => (s ? new Date(s).getTime() : null)

export function TaskSettings({ task }: { task: Task }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [section, setSection] = useState<Section>(task.trialPassedAt || task.status === 'published' ? 'publish' : 'basic')
  const [f, setF] = useState(() => ({
    title: task.title,
    description: task.description,
    opensAt: task.opensAt,
    dueAt: task.dueAt,
    submitKind: task.submitKind,
    accept: task.accept,
    maxBytes: task.maxBytes,
    dailyLimit: task.dailyLimit,
    leaderboard: task.leaderboard,
    higherIsBetter: task.higherIsBetter,
    image: task.image,
    requirements: task.requirements ?? '',
    timeoutSec: task.timeoutSec,
    memoryMb: task.memoryMb,
    graderFileId: task.graderFileId ?? null,
    dataFileId: task.dataFileId ?? null,
  }))
  const [busy, setBusy] = useState(false)
  const graded = useSubmissions(task.id, { all: true, trial: false })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== (task as unknown as typeof f)[k] && !(k === 'requirements' && f[k] === '' && !task.requirements))
  const gradingDirty = GRADING.some((k) => f[k] !== (task[k] ?? (k === 'requirements' ? '' : null)))

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${task.id}`, { method: 'PATCH', body: { version: task.version, ...f, ...extra } })
      qc.setQueryData(['task', task.id], r.task)
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast(extra.status === 'published' ? t('tasks.published') : t('tasks.saved'))
      return r.task
    } catch (err) {
      toastError(err)
      qc.invalidateQueries({ queryKey: ['task', task.id] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <TabBar
        value={section}
        onChange={setSection}
        tabs={[
          { value: 'basic', label: t('tasks.settings.basic') },
          { value: 'grading', label: t('tasks.settings.grading'), badge: !task.graderFileId ? <span className="size-1.5 rounded-full bg-warning" /> : undefined },
          { value: 'rules', label: t('tasks.settings.rules') },
          { value: 'publish', label: t('tasks.settings.publish'), badge: task.trialPassedAt ? <CheckCircle2 className="!size-3.5 text-success" /> : undefined },
        ]}
      />
      {section === 'basic' && (
        <Card className="flex flex-col gap-4 p-5">
          <Field label={t('tasks.field.title')}>{(id) => <Input id={id} value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('tasks.field.opensAt')}>{(id) => <Input id={id} type="datetime-local" value={toLocal(f.opensAt)} onChange={(e) => set('opensAt', fromLocal(e.target.value))} />}</Field>
            <Field label={t('tasks.field.dueAt')}>{(id) => <Input id={id} type="datetime-local" value={toLocal(f.dueAt)} onChange={(e) => set('dueAt', fromLocal(e.target.value))} />}</Field>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label={t('tasks.field.description')}>
              {(id) => (
                <Textarea
                  id={id}
                  value={f.description}
                  onChange={(e) => set('description', e.target.value)}
                  onPaste={async (e) => {
                    // Pasted screenshots become images in the description.
                    const file = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'))
                    if (!file) return
                    e.preventDefault()
                    const at = e.currentTarget.selectionStart
                    try {
                      const up = await uploadFile(await compressImage(file), { parentType: 'task_asset', parentId: task.id })
                      setF((x) => ({ ...x, description: `${x.description.slice(0, at)}![${up.name}](/files/${up.id})${x.description.slice(at)}` }))
                    } catch (err) {
                      toastError(err)
                    }
                  }}
                  className="min-h-72 font-mono text-[13px]"
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-2">{t('settings.preview')}</span>
              <div className="min-h-72 overflow-auto rounded-xl border border-line bg-canvas p-4">
                <Html html={renderMarkdown(f.description)} className="prose-md text-sm" />
              </div>
            </div>
          </div>
        </Card>
      )}
      {section === 'grading' && (
        <Card className="flex flex-col gap-5 p-5">
          <FileSlot label={t('tasks.field.grader')} hint={t('tasks.field.graderHint')} taskId={task.id} fileId={f.graderFileId} accept=".py,.zip" onChange={(id) => set('graderFileId', id)} />
          <FileSlot label={t('tasks.field.data')} hint={t('tasks.field.dataHint')} taskId={task.id} fileId={f.dataFileId} onChange={(id) => set('dataFileId', id)} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('tasks.field.image')}>{(id) => <Input id={id} value={f.image} onChange={(e) => set('image', e.target.value)} className="font-mono" />}</Field>
            <Field label={t('tasks.field.timeout')}>{(id) => <Input id={id} type="number" min={10} value={f.timeoutSec} onChange={(e) => set('timeoutSec', Number(e.target.value))} />}</Field>
            <Field label={t('tasks.field.memory')}>{(id) => <Input id={id} type="number" min={128} step={128} value={f.memoryMb} onChange={(e) => set('memoryMb', Number(e.target.value))} />}</Field>
          </div>
          <Field label={t('tasks.field.requirements')}>
            {(id) => <Textarea id={id} value={f.requirements} placeholder={'numpy\nscikit-learn'} onChange={(e) => set('requirements', e.target.value)} className="min-h-24 font-mono text-[13px]" />}
          </Field>
          <details className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
            <summary className="cursor-pointer font-medium">{t('tasks.contract')}</summary>
            <Html html={renderMarkdown(t('tasks.contractBody'))} className="prose-md mt-2 text-[13px]" />
            <pre className="mt-2 rounded-lg bg-canvas p-3 font-mono text-xs">{'{ "passed": true, "score": 0.913, "message": "準確率 91.3%",\n  "details": [{ "name": "case_1", "passed": true }] }'}</pre>
            <p className="mt-2 text-xs text-fg-3">{t('tasks.contractNote')}</p>
          </details>
        </Card>
      )}
      {section === 'rules' && (
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label={t('tasks.field.kind')}>
            {(id) => (
              <Select id={id} value={f.submitKind} onChange={(e) => set('submitKind', e.target.value as 'file' | 'code')}>
                <option value="file">{t('tasks.field.kind.file')}</option>
                <option value="code">{t('tasks.field.kind.code')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('tasks.field.accept')}>{(id) => <Input id={id} value={f.accept} placeholder={t('tasks.field.acceptPh')} onChange={(e) => set('accept', e.target.value)} />}</Field>
          <Field label={t('tasks.field.maxMb')}>
            {(id) => <Input id={id} type="number" min={1} max={100} value={Math.round(f.maxBytes / 1048576)} onChange={(e) => set('maxBytes', Number(e.target.value) * 1048576)} />}
          </Field>
          <Field label={t('tasks.field.daily')}>{(id) => <Input id={id} type="number" min={1} value={f.dailyLimit} onChange={(e) => set('dailyLimit', Number(e.target.value))} />}</Field>
          <Field label={t('tasks.field.direction')}>
            {(id) => (
              <Select id={id} value={f.higherIsBetter ? 'h' : 'l'} onChange={(e) => set('higherIsBetter', e.target.value === 'h')}>
                <option value="h">{t('tasks.field.higher')}</option>
                <option value="l">{t('tasks.field.lower')}</option>
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input type="checkbox" checked={f.leaderboard} onChange={(e) => set('leaderboard', e.target.checked)} className="size-4 accent-accent" />
            {t('tasks.field.leaderboard')}
          </label>
        </Card>
      )}
      {section === 'publish' && <PublishPanel task={task} busy={busy} dirty={dirty} onPublish={(status) => save({ status })} />}

      {section !== 'publish' && (
        <div className="sticky bottom-20 flex justify-end gap-2 md:bottom-4">
          {gradingDirty && task.status === 'published' && (
            <Button
              icon={<RotateCcw className="size-4" />}
              disabled={busy}
              onClick={async () => {
                if (await confirm({ title: t('tasks.regrade'), body: t('tasks.regradeConfirm', { n: graded.data?.length ?? 0 }) })) save({ regradeAll: true })
              }}
            >
              {t('tasks.regrade')}
            </Button>
          )}
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save()} className="shadow-card">
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  )
}

function FileSlot({ label, hint, taskId, fileId, accept, onChange }: { label: string; hint: string; taskId: string; fileId: string | null; accept?: string; onChange(id: string): void }) {
  const { t, fmt } = useI18n()
  const files = useFiles('task', taskId)
  const current = files.data?.find((x) => x.id === fileId)
  const input = useRef<HTMLInputElement>(null)
  const [pct, setPct] = useState<number | null>(null)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-fg-2">{label}</span>
      <div className={cx('flex items-center gap-3 rounded-xl border p-3', current ? 'border-line bg-surface' : 'border-dashed border-line-strong')}>
        <FileCode2 className="size-5 text-fg-3" />
        <div className="min-w-0 flex-1 text-sm">
          {current ? (
            <>
              <div className="truncate font-medium">{current.name}</div>
              <div className="text-xs text-fg-4">{fmt.bytes(current.size)}</div>
            </>
          ) : (
            <div className="text-fg-4">{hint}</div>
          )}
          {pct !== null && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()} loading={pct !== null}>
          {current ? t('tasks.replace') : t('files.upload')}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept={accept}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setPct(0)
            try {
              const up = await uploadFile(file, { parentType: 'task', parentId: taskId }, { onProgress: setPct })
              await files.refetch()
              onChange(up.id)
            } catch (err) {
              toastError(err)
            } finally {
              setPct(null)
            }
          }}
        />
      </div>
    </div>
  )
}

function PublishPanel({ task, busy, dirty, onPublish }: { task: Task; busy: boolean; dirty: boolean; onPublish(status: Task['status']): void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const trials = useSubmissions(task.id, { all: true, trial: true })
  const input = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const latest = trials.data?.[0]
  // When the latest trial passes, refresh the task so "Publish" unlocks.
  const passed = latest?.status === 'passed' && !task.trialPassedAt
  useEffect(() => {
    if (passed) qc.invalidateQueries({ queryKey: ['task', task.id] })
  }, [passed, qc, task.id])
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
            <FlaskConical className="size-5" />
          </span>
          <div className="flex-1">
            <div className="font-semibold">{t('tasks.trial')}</div>
            <div className="text-sm text-fg-3">{t('tasks.trialHint')}</div>
            <div className="mt-1 text-xs text-fg-4">{t('tasks.runner')}</div>
          </div>
          {task.trialPassedAt && <Badge tone="success">{t('tasks.trialPassed')}</Badge>}
        </div>
        <Button
          className="self-start"
          icon={<Upload className="size-4" />}
          loading={sending}
          disabled={!task.graderFileId || dirty}
          onClick={() => input.current?.click()}
        >
          {t('tasks.trialUpload')}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setSending(true)
            try {
              await api(`/api/tasks/${task.id}/submissions?trial=1`, { method: 'POST', raw: file, headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) } })
              trials.refetch()
            } catch (err) {
              toastError(err)
            } finally {
              setSending(false)
            }
          }}
        />
        {latest && <SubmissionCard s={latest} defaultOpen />}
      </Card>
      <Card className="flex flex-wrap items-center gap-3 p-5">
        <div className="flex-1 text-sm">
          <Badge tone={task.status === 'published' ? 'success' : 'warning'}>{t(`tasks.status.${task.status}`)}</Badge>
          {!task.trialPassedAt && task.status !== 'published' && <span className="ml-2 text-fg-3">{t('tasks.trialNeeded')}</span>}
        </div>
        {task.status === 'published' ? (
          <>
            <Button icon={<RotateCcw className="size-4" />} onClick={() => onPublish('draft')} disabled={busy}>
              {t('tasks.unpublish')}
            </Button>
            <Button icon={<Archive className="size-4" />} onClick={() => onPublish('archived')} disabled={busy}>
              {t('tasks.archive')}
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<Rocket className="size-4" />} loading={busy} disabled={!task.trialPassedAt || dirty} title={!task.trialPassedAt ? t('tasks.trialNeeded') : undefined} onClick={() => onPublish('published')}>
            {t('tasks.publish')}
          </Button>
        )}
      </Card>
    </div>
  )
}
