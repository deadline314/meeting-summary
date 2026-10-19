// Production-build PWA check (dev server has no service worker):
//   npm run build && npx vite preview --port 4173   (in another terminal)
//   node scripts/pwa-check.mjs
// Signs in with the local dev login, opens a few pages so they get cached, goes offline and
// reloads: the app shell, the offline notice and the cached page content must still appear.
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' })
const page = await ctx.newPage()
const fail = (msg) => {
  console.error(`pwa-check: ${msg}`)
  process.exitCode = 1
}
await page.request.post(`${BASE}/auth/dev`, { data: { email: `pwa-${Date.now()}@example.com`, name: '離線測試' } })
await page.request.patch(`${BASE}/api/me`, { data: { onboarded: true, prefs: { toursSeen: ['notes', 'tasks', 'projects'] } } })
const note = (await (await page.request.post(`${BASE}/api/notes`, { data: { title: '離線也能讀的紀錄', startsAt: Date.now() } })).json()).note
await page.goto(`${BASE}/`)
await page.evaluate(() => navigator.serviceWorker.ready)
// The first visit installs the worker; reload so it controls the page and caches API reads.
await page.reload()
await page.waitForFunction(() => !!navigator.serviceWorker.controller)
for (const p of ['/notes', `/notes/${note.id}`, '/']) {
  await page.goto(`${BASE}${p}`)
  await page.waitForLoadState('networkidle')
}
await ctx.setOffline(true)
await page.goto(`${BASE}/notes`).catch(() => undefined)
await page.waitForTimeout(1500)
const text = await page.locator('body').innerText()
if (!text.includes('目前離線')) fail('offline notice missing')
if (!text.includes('離線也能讀的紀錄')) fail('cached notes list missing')
if (!text.includes('會議紀錄')) fail('app shell missing')
await page.screenshot({ path: 'pm/meeting-summary/images/MS-4-offline-mobile-light.png' })
await browser.close()
if (!process.exitCode) console.log('pwa-check: offline shell, notice and cached list OK')
