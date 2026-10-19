import { expect, test } from '@playwright/test'
import { email, isMobile, login, shot } from './helpers'

const NAMES: Record<string, string> = { 'desktop-light': 'Quinn A', 'desktop-dark': 'Quinn B', 'mobile-light': 'Quinn C', 'mobile-dark': 'Quinn D' }

test('component sheet renders every accent in light and dark', async ({ page }, info) => {
  test.skip(isMobile(info), 'developer page, desktop only')
  await login(page, `qa-g-${info.project.name}`, NAMES[info.project.name]!)
  await page.goto('/dev/ui')
  await expect(page.getByText('dark · rose')).toBeVisible()
  await shot(page, info, 'MS-2', 'gallery')
})

test('English UI: no page scrolls sideways', async ({ page }, info) => {
  test.setTimeout(120_000)
  await login(page, `qa-en-${info.project.name}`, NAMES[info.project.name]!)
  await page.request.patch('/api/me', { data: { prefs: { locale: 'en' } } })
  const key = `QE${info.project.name.startsWith('desk') ? 'D' : 'M'}${info.project.name.endsWith('light') ? 'L' : 'K'}`
  await page.request.post('/api/projects', { data: { key, name: 'English check' } })
  await page.request.post(`/api/projects/${key}/issues`, { data: { title: 'A fairly long issue title to see how rows wrap on small screens', dueAt: Date.now() } })
  const note = (await (await page.request.post('/api/notes', { data: { title: 'Weekly sync with a long title', startsAt: Date.now() } })).json()).note
  const pages = ['/', '/notes', `/notes/${note.id}`, '/tasks', '/projects', `/projects/${key}`, `/projects/${key}?view=board`, `/projects/${key}?view=timeline`, `/projects/${key}?view=stats`, `/projects/${key}/${key}-1`, '/projects/timeline', '/settings?tab=profile', '/settings?tab=notifications', '/settings?tab=api']
  const wide: string[] = []
  for (const p of pages) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (over > 1) wide.push(`${p} (+${over}px)`)
  }
  expect(wide).toEqual([])
  await page.goto(`/projects/${key}`)
  await expect(page.getByText('A fairly long issue title', { exact: false })).toBeVisible()
  await shot(page, info, 'MS-3', 'english-projects')
  await page.goto('/settings?tab=notifications')
  await shot(page, info, 'MS-3', 'english-settings')
})

test('shortcut labels follow the platform; phones get long-press menus instead', async ({ page }, info) => {
  const mobile = isMobile(info)
  await login(page, `qa-k-${info.project.name}`, NAMES[info.project.name]!)
  if (!mobile) {
    await page.goto('/')
    await expect(page.locator('aside kbd').first()).toHaveText('Ctrl+K')
    await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }))
    await page.goto('/')
    await expect(page.locator('aside kbd').first()).toHaveText('⌘K')
    await page.keyboard.press('Meta+k')
    await expect(page.getByRole('dialog').getByRole('combobox').or(page.getByRole('dialog').getByRole('textbox')).first()).toBeVisible()
    return
  }
  // Phones: no shortcut hints, the palette opens from the top search button, long-press opens the row menu.
  const key = `QK${info.project.name.endsWith('light') ? 'L' : 'K'}`
  await page.request.post('/api/projects', { data: { key, name: 'Long press' } })
  await page.request.post(`/api/projects/${key}/issues`, { data: { title: '長按我' } })
  await page.goto(`/projects/${key}`)
  await expect(page.locator('header kbd')).toHaveCount(0)
  await page.getByRole('button', { name: '搜尋或執行動作' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  const row = page.locator('li', { hasText: '長按我' })
  const box = (await row.boundingBox())!
  await row.evaluate(async (el, p) => {
    const ev = (type: string) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true, isPrimary: true, pointerId: 3 }))
    ev('pointerdown')
    await new Promise((r) => setTimeout(r, 900))
    ev('pointerup')
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await expect(page.getByRole('menu')).toBeVisible()
  // No shortcut hints on touch, and the menu stays inside the screen.
  await expect(page.getByRole('menu').locator('kbd').first()).toBeHidden()
  await page.waitForTimeout(400)
  const m = (await page.getByRole('menu').boundingBox())!
  expect(m.x + m.width).toBeLessThanOrEqual(390)
  await shot(page, info, 'MS-9', 'long-press')
})

test('typing in a 20,000-character note stays under 50 ms from key to screen', async ({ page }, info) => {
  test.skip(isMobile(info), 'keyboard latency is measured on desktop')
  await login(page, `qa-lat-${info.project.name}`, NAMES[info.project.name]!)
  const note = (await (await page.request.post('/api/notes', { data: { title: 'Latency', startsAt: Date.now() } })).json()).note
  await page.goto(`/notes/${note.id}?mode=edit`)
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(('實驗紀錄 lorem ipsum 0123456789 '.repeat(20) + '\n').repeat(35))
  await page.waitForTimeout(500)
  // Time from each real keydown to the editor's DOM reflecting it, for 30 keys.
  await page.evaluate(() => {
    const el = document.querySelector('.cm-content') as HTMLElement
    const w = window as unknown as { __lags: number[]; __t0: number | null }
    w.__lags = []
    w.__t0 = null
    el.addEventListener('keydown', () => (w.__t0 = performance.now()), true)
    new MutationObserver(() => {
      if (w.__t0 === null) return
      w.__lags.push(performance.now() - w.__t0)
      w.__t0 = null
    }).observe(el, { childList: true, subtree: true, characterData: true })
  })
  await page.keyboard.type('abcdefghijklmnopqrstuvwxyz0123', { delay: 40 })
  const lags = (await page.evaluate(() => (window as unknown as { __lags: number[] }).__lags)).sort((x, y) => x - y)
  expect(lags.length).toBeGreaterThanOrEqual(25)
  const p95 = lags[Math.floor(lags.length * 0.95)]!
  expect(p95).toBeLessThan(50)
})

test('session runs out mid-comment: sign in again in a small window, the text is still there', async ({ page }, info) => {
  const who = `qa-exp-${info.project.name}`
  await login(page, who, NAMES[info.project.name]!)
  const key = `QX${info.project.name.startsWith('desk') ? 'D' : 'M'}${info.project.name.endsWith('light') ? 'L' : 'K'}`
  await page.request.post('/api/projects', { data: { key, name: 'Expiry' } })
  await page.request.post(`/api/projects/${key}/issues`, { data: { title: '寫到一半' } })
  await page.goto(`/projects/${key}/${key}-1`)
  const box = page.getByPlaceholder(/留言…/)
  await box.fill('這段留言還沒送出')
  // The session ends elsewhere (expired or signed out on another device).
  await page.request.post('/auth/logout')
  await page.getByRole('button', { name: '送出' }).click()
  await expect(page.getByRole('dialog', { name: '登入已過期' })).toBeVisible()
  await shot(page, info, 'MS-6', 'expired')
  const popupP = page.waitForEvent('popup')
  await page.getByRole('button', { name: '重新登入' }).click()
  const popup = await popupP
  await popup.getByLabel('Email').fill(email(who))
  await popup.getByRole('button', { name: '登入' }).click()
  await popup.waitForEvent('close')
  await expect(page.getByRole('dialog', { name: '登入已過期' })).toHaveCount(0)
  await expect(box).toHaveValue('這段留言還沒送出')
  await page.getByRole('button', { name: '送出' }).click()
  await expect(page.getByText('這段留言還沒送出').first()).toBeVisible()
})
