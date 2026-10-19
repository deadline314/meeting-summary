import { expect, test } from '@playwright/test'
import { cast, email, isMobile, shot } from './helpers'

test('sign-in, welcome, home, settings, admin', async ({ page }, info) => {
  const mobile = isMobile(info)
  const tag = info.project.name
  const [, , teacherName] = cast(info)

  // Login page with the local dev panel.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('本機測試登入')).toBeVisible()
  await shot(page, info, 'MS-5', 'login')

  // Teacher signs in for the first time → welcome page pre-filled with the Google name.
  await page.getByLabel('Email').fill(email(`teacher-${tag}`))
  await page.getByLabel('名稱').fill(teacherName)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page).toHaveURL(/\/welcome/)
  await expect(page.getByLabel('顯示名稱')).toHaveValue(teacherName)
  await shot(page, info, 'MS-5', 'welcome')
  await page.getByRole('button', { name: '開始使用' }).click()
  await expect(page.getByRole('heading', { name: `嗨，${teacherName}` })).toBeVisible()
  // The deployment's real teacher (OWNER_EMAILS) makes this account a teacher too.
  const owner = await page.context().browser()!.newContext({ baseURL: 'http://localhost:5174' })
  await owner.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  const myId = (await (await page.request.get('/api/me')).json()).user.id
  expect((await owner.request.patch(`/api/admin/members/${myId}`, { data: { role: 'owner' } })).ok()).toBe(true)
  await owner.close()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shot(page, info, 'MS-10', 'home')

  // Settings: profile rename, appearance, devices.
  await page.goto('/settings?tab=profile')
  await page.getByLabel('顯示名稱').fill(`${teacherName}（助教）`)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('名稱已更新')).toBeVisible()
  await shot(page, info, 'MS-7', 'rename')
  await page.goto('/settings?tab=appearance')
  await page.getByRole('button', { name: '翡翠' }).click()
  await shot(page, info, 'MS-2', 'appearance')
  await page.getByRole('button', { name: '靛藍' }).click()
  await page.goto('/settings?tab=devices')
  await expect(page.getByText('此裝置')).toBeVisible()
  await shot(page, info, 'MS-6', 'devices')

  // Language switch to English and back.
  await page.goto('/settings?tab=appearance')
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await shot(page, info, 'MS-3', 'english')
  await page.getByRole('button', { name: '中文' }).click()

  // Command palette (desktop shortcut).
  if (!mobile) {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('搜尋動作')).toBeVisible()
    await page.keyboard.type('會議')
    await shot(page, info, 'MS-9', 'palette')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('Shift+?')
    await expect(page.getByRole('dialog', { name: '快捷鍵' })).toBeVisible()
    await shot(page, info, 'MS-9', 'shortcuts')
    await page.keyboard.press('Escape')
  }

  // Admin: owner rotates the admin key; members list.
  await page.goto('/admin?tab=site')
  await page.getByRole('button', { name: '管理員金鑰' }).click()
  await page.getByRole('button', { name: '產生新金鑰' }).click()
  // A key already exists from an earlier run: rotating asks for confirmation first.
  const confirmBtn = page.getByRole('dialog').getByRole('button', { name: '確認' })
  if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click()
  await expect(page.getByText('新金鑰（只顯示一次）')).toBeVisible()
  const key = (await page.locator('code').first().innerText()).trim()
  await shot(page, info, 'MS-8', 'admin-key')
  await page.goto('/admin?tab=members')
  await expect(page.getByText(email(`teacher-${tag}`))).toBeVisible()
  await shot(page, info, 'MS-43', 'members')

  // A student redeems the key in their own session.
  const ctx = await page.context().browser()!.newContext({ ...info.project.use, baseURL: 'http://localhost:5174' })
  const s = await ctx.newPage()
  await s.request.post('/auth/dev', { data: { email: email(`ta-${tag}`), name: '學長' } })
  await s.request.patch('/api/me', { data: { onboarded: true } })
  await s.goto('/settings?tab=admin')
  await s.getByLabel('輸入金鑰').fill(key)
  await s.getByRole('button', { name: '升級' }).click()
  await expect(s.getByText('你已是管理員')).toBeVisible()
  await shot(s, info, 'MS-8', 'redeemed')
  await ctx.close()

  // Activity feed shows the rename and the role change.
  await page.goto('/admin?tab=activity')
  await expect(page.getByText(/改成「/).first()).toBeVisible()
  await shot(page, info, 'MS-44', 'activity')
})

test('API keys: create, copy one-line MCP command, use it, revoke', async ({ page }, info) => {
  const tag = info.project.name
  await page.request.post('/auth/dev', { data: { email: email(`keys-${tag}`), name: '金鑰測試' } })
  await page.request.patch('/api/me', { data: { onboarded: true } })
  await page.goto('/settings?tab=api')
  await page.getByRole('button', { name: '產生 API Key' }).click()
  await page.getByLabel('名稱').fill('我的筆電 Claude Code')
  await shot(page, info, 'MS-42', 'create')
  await page.getByRole('dialog').getByRole('button', { name: '建立' }).click()
  await expect(page.getByText('這把金鑰只會顯示這一次')).toBeVisible()
  const cli = await page.locator('code', { hasText: 'claude mcp add' }).innerText()
  expect(cli).toMatch(/claude mcp add --transport http lab-notes http:\/\/localhost:5174\/mcp --header "Authorization: Bearer msk_/)
  await shot(page, info, 'MS-42', 'created')
  const secret = /Bearer (msk_[\w-]+)/.exec(cli)![1]!
  // The key works against the MCP endpoint.
  const r = await page.request.post('/mcp', { headers: { authorization: `Bearer ${secret}` }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  expect(r.ok()).toBe(true)
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.getByText('我的筆電 Claude Code')).toBeVisible()
  await shot(page, info, 'MS-42', 'list')
  await page.getByRole('button', { name: '撤銷' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '撤銷' }).click()
  await expect(page.getByText('已撤銷')).toBeVisible()
  const after = await page.request.post('/mcp', { headers: { authorization: `Bearer ${secret}` }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  expect(after.status()).toBe(401)
})
