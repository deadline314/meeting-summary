import { useQuery } from '@tanstack/react-query'
import { HardDrive, ShieldAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { pickDriveFiles, type PickerConfig } from '../../lib/drive-picker'
import { useI18n } from '../../lib/i18n'
import { driveKind } from '../../lib/markdown'
import { Button } from '../../ui/button'
import { toastError } from '../../ui/toast'

export type DriveLinked = { name: string; url: string }

const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<{ drivePicker?: PickerConfig | null }>('/api/config'), staleTime: 300_000 })

/** Attach a Drive URL (no size limit, no permission changes; removing it never touches the Drive file). */
export async function linkDriveUrl(parent: { parentType: string; parentId: string }, url: string, name?: string, mime?: string, owner?: string | null) {
  await api('/api/files/drive', { method: 'POST', body: { ...parent, url, name: name || driveKind(url), ...(mime && { mime }), owner: owner ?? null } })
  return { name: name || driveKind(url), url }
}

/**
 * "Pick from Google Drive" when the site has a picker key configured. Declined or revoked access
 * shows guidance with a retry button rather than an error.
 */
export function DrivePickerButton({ parentType, parentId, onLinked }: { parentType: string; parentId: string; onLinked(files: DriveLinked[]): void }) {
  const { t, locale } = useI18n()
  const cfg = useConfig().data?.drivePicker
  const [needAuth, setNeedAuth] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!cfg) return null
  const pick = async () => {
    setBusy(true)
    try {
      const files = await pickDriveFiles(cfg, locale)
      if (files === null) return setNeedAuth(true)
      setNeedAuth(false)
      if (!files?.length) return
      onLinked(await Promise.all(files.map((f) => linkDriveUrl({ parentType, parentId }, f.url, f.name, f.mime, f.owner))))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button size="sm" variant="secondary" icon={<HardDrive className="size-3.5" />} loading={busy} onClick={pick}>
        {t('drive.pick')}
      </Button>
      {needAuth && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex w-full flex-col items-start gap-2 rounded-xl bg-warning-soft p-3 text-left text-xs text-warning">
          <span className="flex items-center gap-1.5 font-semibold">
            <ShieldAlert className="size-4" /> {t('drive.authTitle')}
          </span>
          <span className="text-fg-3">{t('drive.authHint')}</span>
          <Button size="sm" variant="primary" onClick={pick}>
            {t('drive.connect')}
          </Button>
        </motion.div>
      )}
    </div>
  )
}
