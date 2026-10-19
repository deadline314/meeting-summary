import { useMutation, useQuery } from '@tanstack/react-query'
import { Atom, BookOpen, Brain, Cpu, FileText, FlaskConical, GraduationCap, KeyRound, Microscope, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ComponentType } from 'react'
import { api, queryClient } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { useMe } from '../../lib/session'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { confirm } from '../../ui/dialog'
import { Field, Input, Textarea } from '../../ui/field'
import { Card, Skeleton } from '../../ui/misc'
import { Segmented } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'

/** Preset site icons (stored by name); `doc` is the built-in logo. */
export const SITE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  doc: FileText,
  flask: FlaskConical,
  cap: GraduationCap,
  microscope: Microscope,
  book: BookOpen,
  atom: Atom,
  brain: Brain,
  cpu: Cpu,
}

type Settings = {
  site: { name: string; icon: string }
  file_limits: { maxFileBytes: number; quotaBytes: number }
  grading_defaults: { timeoutSec: number; memoryMb: number; dailyLimit: number; maxBytes: number }
  note_template_zh: string
  note_template_en: string
}
type SubTab = 'general' | 'template' | 'files' | 'grading' | 'key'
const MB = 1024 * 1024

const useSettings = () => useQuery({ queryKey: ['admin-settings'], queryFn: () => api<Settings>('/api/admin/settings') })

function useSave() {
  const { t } = useI18n()
  return async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    try {
      await api(`/api/admin/settings/${key}`, { method: 'PUT', body: { value } })
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast(t('common.saved'))
    } catch (err) {
      toastError(err)
    }
  }
}

export function SiteSettingsPanel() {
  const { t } = useI18n()
  const [tab, setTab] = useState<SubTab>('general')
  const q = useSettings()
  return (
    <div className="flex flex-col gap-4">
      <Segmented<SubTab>
        className="self-start max-md:w-full max-md:overflow-x-auto"
        value={tab}
        onChange={setTab}
        options={(['general', 'template', 'files', 'grading', 'key'] as const).map((v) => ({ value: v, label: t(`site.tab.${v}` as MsgKey) }))}
      />
      <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
        {tab === 'key' ? <AdminKeyCard /> : q.isPending ? <Skeleton className="h-48" /> : q.isError ? null : <Form tab={tab} s={q.data} key={tab} />}
      </motion.div>
    </div>
  )
}

function Form({ tab, s }: { tab: Exclude<SubTab, 'key'>; s: Settings }) {
  const { t } = useI18n()
  const save = useSave()
  const [name, setName] = useState(s.site.name)
  const [icon, setIcon] = useState(s.site.icon || 'doc')
  const [lang, setLang] = useState<'zh' | 'en'>('zh')
  const [tpl, setTpl] = useState({ zh: s.note_template_zh, en: s.note_template_en })
  const [files, setFiles] = useState({ max: s.file_limits.maxFileBytes / MB, quota: s.file_limits.quotaBytes / MB })
  const [g, setG] = useState({ ...s.grading_defaults, maxBytes: s.grading_defaults.maxBytes / MB })
  const num = (v: string) => Math.max(0, Number(v) || 0)
  if (tab === 'general')
    return (
      <Card className="flex flex-col gap-4 p-5">
        <Field label={t('site.name')} hint={t('site.nameHint')}>
          {(id) => <Input id={id} value={name} maxLength={40} placeholder={t('app.name')} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg-2">{t('site.icon')}</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SITE_ICONS).map(([k, Icon]) => (
              <button
                key={k}
                type="button"
                aria-label={k}
                aria-pressed={icon === k}
                onClick={() => setIcon(k)}
                className={cx('flex size-11 items-center justify-center rounded-xl border transition-colors', icon === k ? 'border-accent bg-accent text-accent-fg' : 'border-line text-fg-3 hover:border-line-strong')}
              >
                <Icon className="size-5" />
              </button>
            ))}
          </div>
        </div>
        <Button variant="primary" className="self-end" onClick={() => save('site', { name: name.trim(), icon })}>
          {t('common.save')}
        </Button>
      </Card>
    )
  if (tab === 'template')
    return (
      <Card className="flex flex-col gap-3 p-5">
        <p className="text-sm text-fg-3">{t('site.templateHint')}</p>
        <Segmented<'zh' | 'en'> className="self-start" value={lang} onChange={setLang} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
        <Textarea
          value={tpl[lang]}
          onChange={(e) => setTpl((x) => ({ ...x, [lang]: e.target.value }))}
          placeholder={t('site.templatePh')}
          aria-label={t('site.tab.template')}
          className="min-h-80 font-mono text-[13px]"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setTpl((x) => ({ ...x, [lang]: '' }))}>
            {t('site.templateReset')}
          </Button>
          <Button variant="primary" onClick={() => save(lang === 'zh' ? 'note_template_zh' : 'note_template_en', tpl[lang])}>
            {t('common.save')}
          </Button>
        </div>
      </Card>
    )
  if (tab === 'files')
    return (
      <Card className="flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('site.maxFile')} hint="MB">
            {(id) => <Input id={id} type="number" min={1} max={100} value={files.max} onChange={(e) => setFiles((x) => ({ ...x, max: num(e.target.value) }))} />}
          </Field>
          <Field label={t('site.quota')} hint="MB">
            {(id) => <Input id={id} type="number" min={10} value={files.quota} onChange={(e) => setFiles((x) => ({ ...x, quota: num(e.target.value) }))} />}
          </Field>
        </div>
        <Button variant="primary" className="self-end" onClick={() => save('file_limits', { maxFileBytes: Math.round(files.max * MB), quotaBytes: Math.round(files.quota * MB) })}>
          {t('common.save')}
        </Button>
      </Card>
    )
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="text-sm text-fg-3">{t('site.gradingHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('site.timeout')} hint={t('site.seconds')}>
          {(id) => <Input id={id} type="number" min={10} max={3600} value={g.timeoutSec} onChange={(e) => setG((x) => ({ ...x, timeoutSec: num(e.target.value) }))} />}
        </Field>
        <Field label={t('site.memory')} hint="MB">
          {(id) => <Input id={id} type="number" min={256} max={14336} value={g.memoryMb} onChange={(e) => setG((x) => ({ ...x, memoryMb: num(e.target.value) }))} />}
        </Field>
        <Field label={t('site.daily')}>
          {(id) => <Input id={id} type="number" min={1} max={100} value={g.dailyLimit} onChange={(e) => setG((x) => ({ ...x, dailyLimit: num(e.target.value) }))} />}
        </Field>
        <Field label={t('site.submitMax')} hint="MB">
          {(id) => <Input id={id} type="number" min={1} max={100} value={g.maxBytes} onChange={(e) => setG((x) => ({ ...x, maxBytes: num(e.target.value) }))} />}
        </Field>
      </div>
      <Button variant="primary" className="self-end" onClick={() => save('grading_defaults', { ...g, maxBytes: Math.round(g.maxBytes * MB) })}>
        {t('common.save')}
      </Button>
    </Card>
  )
}

function AdminKeyCard() {
  const me = useMe()
  const { t } = useI18n()
  const status = useQuery({ queryKey: ['admin-key'], queryFn: () => api<{ configured: boolean }>('/api/admin/admin-key') })
  const [fresh, setFresh] = useState<string | null>(null)
  const rotate = useMutation({
    mutationFn: () => api<{ key: string }>('/api/admin/admin-key/rotate', { method: 'POST' }),
    onSuccess: (r) => {
      setFresh(r.key)
      queryClient.invalidateQueries({ queryKey: ['admin-key'] })
    },
    onError: (e) => toastError(e),
  })
  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4 text-accent-text" /> {t('admin.adminKey')}
      </div>
      <p className="mb-4 text-sm text-fg-3">{status.data?.configured ? t('admin.adminKeySet') : t('admin.adminKeyNone')}</p>
      {fresh && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mb-4 rounded-xl border border-accent bg-accent-soft p-3">
          <div className="mb-1 text-xs font-medium text-accent-text">{t('admin.newKey')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm break-all">{fresh}</code>
            <Button size="sm" onClick={() => navigator.clipboard.writeText(fresh).then(() => toast(t('common.copied')))}>
              {t('common.copy')}
            </Button>
          </div>
        </motion.div>
      )}
      {me.role === 'owner' && (
        <Button
          onClick={async () => {
            if (!status.data?.configured || (await confirm({ title: t('admin.rotate'), body: t('admin.rotateConfirm'), danger: true }))) rotate.mutate()
          }}
          loading={rotate.isPending}
          icon={<RotateCcw className="size-4" />}
        >
          {t('admin.rotate')}
        </Button>
      )}
    </Card>
  )
}
