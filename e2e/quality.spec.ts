import { expect, test } from '@playwright/test'
import { isMobile, login, shot } from './helpers'

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
