import { expect, test } from '@playwright/test'
import { email, isMobile, login, newUserPage, shot } from './helpers'

const NAMES: Record<string, [string, string]> = { 'desktop-light': ['PZAA', '殷志遠'], 'desktop-dark': ['PZAB', '樊心怡'], 'mobile-light': ['PZAC', '饒家瑋'], 'mobile-dark': ['PZAD', '卓佩儀'] }

test('notes: fenced code is highlighted; offline banner; export survives a broken image', async ({ page }, info) => {
  const mobile = isMobile(info)
  const [, name] = NAMES[info.project.name]!
  await login(page, `pz-${info.project.name}`, name)
  const note = (await (await page.request.post('/api/notes', { data: { title: '程式碼討論', startsAt: Date.now() } })).json()).note
  await page.goto(`/notes/${note.id}${mobile ? '?mode=edit' : ''}`)
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('```python\ndef train(lr=0.01):\n    return lr * 2\n```\n\n![壞掉的圖](/files/does-not-exist)\n\n')
  if (mobile) await page.goto(`/notes/${note.id}?mode=preview`)
  // MS-18: fenced code gets syntax colours.
  const code = page.locator('pre > code.hljs').first()
  await expect(code).toBeVisible()
  await expect(code.locator('.hljs-keyword').first()).toHaveText('def')
  await code.scrollIntoViewIfNeeded()
  await shot(page, info, 'MS-18', 'fence')

  // MS-12: losing the connection shows the offline banner; it goes away when back online.
  await page.context().setOffline(true)
  await expect(page.getByRole('status').filter({ hasText: '離線中，內容會在連線後同步' })).toBeVisible({ timeout: 15_000 })
  await shot(page, info, 'MS-12', 'offline')
  await page.context().setOffline(false)
  await expect(page.getByRole('status').filter({ hasText: '離線中' })).toHaveCount(0, { timeout: 20_000 })

  // MS-46: export shows progress and still finishes when an image can't be read.
  await page.goto(`/notes/${note.id}?mode=preview`)
  await expect(page.getByText('def train')).toBeVisible()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: '編輯' }).first().click()
  await page.getByRole('menuitem', { name: /匯出 HTML/ }).click()
  const path = test.info().outputPath('broken.html')
  await (await dl).saveAs(path)
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(path, 'utf8')
  expect(html).toContain('此檔案無法匯出')
  expect(html).toContain('def train')
})

test('issues across projects, admin members as cards on phones', async ({ page, browser }, info) => {
  const [key, name] = NAMES[info.project.name]!
  await login(page, `pz2-${info.project.name}`, name)
  const r = page.request
  await r.post('/api/projects', { data: { key, name: '跨專案一' } })
  await r.post('/api/projects', { data: { key: `${key.slice(0, 2)}X${key.slice(3)}`, name: '跨專案二' } })
  await r.post(`/api/projects/${key}/issues`, { data: { title: '量測 GPU 記憶體' } })
  await r.post(`/api/projects/${key.slice(0, 2)}X${key.slice(3)}/issues`, { data: { title: '量測推論延遲' } })
  // MS-39: All projects + search by words or key, in the URL.
  await page.goto('/projects?all=true&q=量測')
  await expect(page.getByRole('heading', { name: '所有議題' })).toBeVisible()
  await expect(page.locator('li', { hasText: '量測 GPU 記憶體' })).toBeVisible()
  await expect(page.locator('li', { hasText: '量測推論延遲' })).toBeVisible()
  await shot(page, info, 'MS-39', 'all-projects')
  await page.goto(`/projects?all=true&q=${key}-1`)
  await expect(page.locator('li', { hasText: '量測 GPU 記憶體' })).toBeVisible()
  await expect(page.locator('li', { hasText: '量測推論延遲' })).toHaveCount(0)

  // MS-43: the members list (teacher view) is cards on phones.
  const owner = await newUserPage(browser, info, 'owner-root', '系統老師')
  await owner.page.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  await owner.page.request.patch('/api/me', { data: { onboarded: true, prefs: { toursSeen: ['notes', 'tasks', 'projects'] } } })
  await owner.page.goto('/admin?tab=members')
  await owner.page.getByLabel('搜尋名稱或 Email').fill(email(`pz2-${info.project.name}`))
  await expect(owner.page.getByText(name).first()).toBeVisible()
  await shot(owner.page, info, 'MS-43', 'cards')
  await owner.ctx.close()
})
