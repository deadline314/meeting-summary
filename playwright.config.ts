import { defineConfig, devices } from '@playwright/test'

// Acceptance runs: every spec runs on desktop + mobile, light + dark, and saves screenshots
// for the ticket's Commit section (pm/meeting-summary/images/).
const desktop = { viewport: { width: 1440, height: 900 } }
const mobile = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure', locale: 'zh-TW' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://localhost:5174/api/health', reuseExistingServer: false, timeout: 180_000 },
  projects: [
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
    { name: 'mobile-light', use: { ...mobile, colorScheme: 'light' } },
    { name: 'mobile-dark', use: { ...mobile, colorScheme: 'dark' } },
  ],
})
