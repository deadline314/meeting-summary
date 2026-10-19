import { Bell, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { ACCENTS } from '../../lib/theme'
import { Avatar } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { Input, Select, Textarea } from '../../ui/field'
import { Badge, Card, EmptyState, Kbd, Skeleton, Spinner } from '../../ui/misc'
import { Segmented, TabBar } from '../../ui/tabs'
import { IssueStatusIcon, PriorityIcon } from '../projects/icons'
import { LabelChip } from '../projects/pickers'

/**
 * Development-only component sheet (`/dev/ui`): every building block side by side in light and
 * dark for the five accents, so a token change can be checked in one screen.
 */
export function ComponentGallery() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <h1 className="text-xl font-bold">{t('dev.gallery')}</h1>
      {(['light', 'dark'] as const).map((mode) => (
        <div key={mode} data-mode={mode} className="grid gap-4 rounded-2xl bg-canvas p-4 text-fg xl:grid-cols-2">
          {ACCENTS.map((accent) => (
            <div key={accent} data-accent={accent}>
              <Sample label={`${mode} · ${accent}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Sample({ label }: { label: string }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'a' | 'b'>('a')
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-xs font-semibold text-fg-4">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />}>
          {t('common.create')}
        </Button>
        <Button>{t('common.cancel')}</Button>
        <Button variant="soft">{t('common.edit')}</Button>
        <Button variant="ghost">{t('common.close')}</Button>
        <Button variant="danger" icon={<Trash2 className="size-4" />}>
          {t('common.delete')}
        </Button>
        <IconButton label={t('nav.notifications')} icon={<Bell />} />
        <Spinner className="size-4" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <LabelChip key={i} label={{ id: String(i), name: `L${i + 1}`, color: i + 1 }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const).map((s) => (
          <IssueStatusIcon key={s} status={s} />
        ))}
        {(['urgent', 'high', 'medium', 'low', 'none'] as const).map((p) => (
          <PriorityIcon key={p} priority={p} />
        ))}
        <Kbd keys="mod+k" />
        <Avatar id="gallery" name="Lab" size="sm" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder={t('common.search')} aria-label={t('common.search')} />
        <Select aria-label={t('common.all')}>
          <option>{t('common.all')}</option>
        </Select>
      </div>
      <Textarea placeholder={t('issue.descPh')} aria-label={t('issue.descPh')} rows={2} />
      <TabBar value={tab} onChange={setTab} tabs={[{ value: 'a', label: 'Tab A' }, { value: 'b', label: 'Tab B' }]} />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
      <p className="text-sm">
        <span className="text-fg">fg</span> · <span className="text-fg-2">fg-2</span> · <span className="text-fg-3">fg-3</span> · <span className="text-fg-4">fg-4</span> · <span className="text-accent-text">accent</span>
      </p>
      <Skeleton className="h-6" />
      <EmptyState title={t('common.noResults')} />
    </Card>
  )
}
