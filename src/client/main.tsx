import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandPalette, ShortcutHelp } from './app/palette'
import { UpdatePrompt } from './app/pwa'
import { makeRouter } from './app/router'
import { installKeyboard } from './lib/actions'
import { queryClient } from './lib/api'
import { I18nProvider, initialLocale } from './lib/i18n'
import { applyTheme, readTheme } from './lib/theme'
import { ConfirmHost } from './ui/dialog'
import { Toaster } from './ui/toast'
import { TooltipProvider } from './ui/tooltip'
import './styles.css'

applyTheme(readTheme())
document.documentElement.lang = initialLocale() === 'zh' ? 'zh-Hant' : 'en'

const router = makeRouter(queryClient)

function App() {
  useEffect(() => installKeyboard(), [])
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <MotionConfig reducedMotion="user">
            <TooltipProvider>
              <RouterProvider router={router} />
              <CommandPalette />
              <ShortcutHelp />
              <ConfirmHost />
              <Toaster />
              <UpdatePrompt />
            </TooltipProvider>
          </MotionConfig>
        </I18nProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
