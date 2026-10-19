import { RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useT } from '../lib/i18n'
import { Button } from '../ui/button'

/** Never reloads on its own: the user picks the moment, so nothing being edited is lost. */
export function UpdatePrompt() {
  const t = useT()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60_000)
    },
  })
  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed inset-x-4 bottom-24 z-[75] mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card md:bottom-5 md:left-5 md:mx-0"
        >
          <RefreshCw className="size-4 text-accent-text" />
          <span className="flex-1 text-sm font-medium">{t('common.updateReady')}</span>
          <Button size="sm" variant="primary" onClick={() => updateServiceWorker(true)}>
            {t('common.reload')}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
