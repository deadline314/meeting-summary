import { expect, test } from '@playwright/test'
import { isMobile, login, shot } from './helpers'

const CAST: Record<string, [string, string]> = { 'desktop-light': ['PLAA', '溫子傑'], 'desktop-dark': ['PLAB', '魏欣妍'], 'mobile-light': ['PLAC', '廖柏翰'], 'mobile-dark': ['PLAD', '崔雅筑'] }

test('PM: templates, filters, relations menu, restore, return to list, board moves', async ({ page }, info) => {
  test.setTimeout(150_000)
  const mobile = isMobile(info)
  const [key, name] = CAST[info.project.name]!
  await login(page, `pl-${info.project.name}`, name)
  const r = page.request
  await r.post('/api/projects', { data: { key, name: '收尾測試' } })
  await r.post('/api/issue-templates', { data: { scope: 'project', key, name: 'Bug 回報', body: '## 重現步驟\n1. \n\n## 預期結果\n', isDefault: true } })
  await r.post('/api/issue-templates', { data: { scope: 'user', name: '實驗紀錄', body: '## 假設\n\n## 結果\n' } })
  const mk = async (title: string, o: Record<string, unknown> = {}) => (await (await r.post(`/api/projects/${key}/issues`, { data: { title, ...o } })).json()).issue
  const a = await mk('修正登入逾時', { dueAt: Date.now() - 86400_000 })
  const b = await mk('更新說明文件', { dueAt: Date.now() + 2 * 86400_000 })
  const c = await mk('重複的登入問題')

  // MS-29: the project default fills the description; switching overwrites; Ctrl/⌘+Z undoes it.
  await page.goto(`/projects/${key}`)
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  const dlg = page.getByRole('dialog')
  const desc = dlg.getByLabel('描述（支援 Markdown，- [ ] 可勾選）')
  await expect(desc).toHaveValue(/重現步驟/)
  await dlg.getByRole('button', { name: '模板' }).click()
  await page.getByRole('button', { name: /實驗紀錄/ }).click()
  await expect(desc).toHaveValue(/假設/)
  await shot(page, info, 'MS-29', 'template')
  await desc.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(desc).toHaveValue(/重現步驟/)
  await page.keyboard.press('Escape')
  await page.getByRole('alertdialog').getByRole('button', { name: '刪除' }).click()

  // MS-30: status / due filters live in the URL.
  await page.goto(`/projects/${key}`)
  await page.getByRole('button', { name: '篩選' }).click()
  await page.getByLabel('截止日').selectOption('overdue')
  await expect(page).toHaveURL(/due=overdue/)
  await expect(page.locator('li', { hasText: '修正登入逾時' })).toBeVisible()
  await expect(page.locator('li', { hasText: '更新說明文件' })).toHaveCount(0)
  await shot(page, info, 'MS-30', 'filters')

  // MS-34: mark a duplicate from the context menu (desktop) and close it.
  if (!mobile) {
    await page.goto(`/projects/${key}`)
    await page.locator('li', { hasText: '重複的登入問題' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '建立關聯' }).hover()
    await page.getByRole('menuitem', { name: /重複於/ }).click()
    await page.getByRole('dialog').getByLabel('輸入議題編號或標題').fill('逾時')
    await page.getByRole('button', { name: /修正登入逾時/ }).click()
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /也要關閉/ }))).toBeVisible()
    await shot(page, info, 'MS-34', 'duplicate-close')
    await page.getByRole('button', { name: '改為已取消' }).click()
    await expect.poll(async () => (await (await r.get(`/api/issues/${c.ref}`)).json()).issue.status).toBe('canceled')
  }

  // MS-28: the first two attempts of an edit hit a network error; it still lands once.
  await page.goto(`/projects/${key}`)
  let dropped = 0
  await page.route(`**/api/issues/${a.ref}`, (route) => {
    if (route.request().method() === 'PATCH' && dropped < 2) {
      dropped++
      return route.abort('failed')
    }
    return route.fallback()
  })
  await page.locator('li', { hasText: '修正登入逾時' }).getByRole('button', { name: '狀態' }).click()
  await page.getByRole('button', { name: '審查中', exact: true }).click()
  await expect.poll(async () => (await (await r.get(`/api/issues/${a.ref}`)).json()).issue.status, { timeout: 10_000 }).toBe('in_review')
  expect(dropped).toBe(2)
  await page.unroute(`**/api/issues/${a.ref}`)

  // MS-33: back from an issue, the list selects it again.
  await page.goto(`/projects/${key}`)
  await page.locator('li', { hasText: '更新說明文件' }).getByText('更新說明文件').click()
  await page.waitForURL(/-2$/)
  // Keep the pointer off the list: hovering a row moves the selection, as it should.
  await page.mouse.move(5, 5)
  await page.goBack()
  await expect(page.locator('li[data-ref$="-2"]')).toHaveClass(/bg-surface-2/)

  // MS-27: delete then restore from project settings.
  await r.delete(`/api/issues/${a.ref}`)
  await page.goto(`/projects/${key}?settings=lifecycle`)
  await expect(page.getByText('已刪除的議題')).toBeVisible()
  await shot(page, info, 'MS-27', 'trash')
  await page.getByRole('button', { name: '還原' }).click()
  await expect(page.getByText(`已還原 ${a.ref}`)).toBeVisible()
  expect((await r.get(`/api/issues/${a.ref}`)).status()).toBe(200)

  // MS-31: board — →/← move between columns (desktop); long-press drag (phones).
  await page.goto(`/projects/${key}?view=board`)
  await expect(page.locator('[data-ref]').first()).toBeVisible()
  if (!mobile) {
    const cur = (await (await r.get(`/api/issues/${b.ref}`)).json()).issue
    await r.patch(`/api/issues/${b.ref}`, { data: { version: cur.version, status: 'in_progress' } })
    await page.reload()
    await page.locator(`[data-ref="${a.ref}"]`).hover()
    await page.mouse.move(5, 5)
    // a is in review (from the retry step), b in progress: ← moves to b's column.
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator(`[data-ref="${b.ref}"]`)).toHaveClass(/ring-accent-soft/)
  } else {
    const card = page.locator(`[data-ref="${a.ref}"]`)
    const target = page.locator('[data-column="in_progress"]')
    await target.scrollIntoViewIfNeeded().catch(() => undefined)
    const from = (await card.boundingBox())!
    const to = (await target.boundingBox())!
    await card.evaluate(async (el, p) => {
      const ev = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerId: 7 }))
      ev('pointerdown', p.fx, p.fy)
      await new Promise((r) => setTimeout(r, 600))
      ev('pointermove', p.tx, p.ty)
      ev('pointerup', p.tx, p.ty)
    }, { fx: from.x + 20, fy: from.y + 20, tx: to.x + to.width / 2, ty: to.y + 40 })
    await expect.poll(async () => (await (await r.get(`/api/issues/${a.ref}`)).json()).issue.status).toBe('in_progress')
  }
  await shot(page, info, 'MS-31', 'board')
})
