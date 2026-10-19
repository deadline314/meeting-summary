import { expect, test, type Page } from '@playwright/test'
import { isMobile, login, newUserPage, shot } from './helpers'

// Per-project names and keys (all four projects share one database).
const P: Record<string, { tag: string; owner: string; b: string; c: string }> = {
  'desktop-light': { tag: 'DL', owner: '馬可', b: '安娜', c: '提姆' },
  'desktop-dark': { tag: 'DK', owner: '露西', b: '亞當', c: '莎拉' },
  'mobile-light': { tag: 'ML', owner: '凱文', b: '茱蒂', c: '保羅' },
  'mobile-dark': { tag: 'MK', owner: '艾瑪', b: '傑克', c: '蘿拉' },
}

async function longPress(selector: ReturnType<Page['locator']>) {
  const box = (await selector.boundingBox())!
  await selector.evaluate(async (el, p) => {
    const ev = (type: string) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true, isPrimary: true, pointerId: 3 }))
    ev('pointerdown')
    await new Promise((r) => setTimeout(r, 900))
    ev('pointerup')
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
}

/** Right-click on desktop, long-press on phones. */
const openMenu = (_page: Page, el: ReturnType<Page['locator']>, mobile: boolean) => (mobile ? longPress(el) : el.click({ button: 'right' }))

test('settings respond at once in a 300-issue project; members, roles and who can see', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const c = P[info.project.name]!
  const b = await newUserPage(browser, info, `hb-${info.project.name}`, c.b)
  const cc = await newUserPage(browser, info, `hc-${info.project.name}`, c.c)
  await login(page, `ho-${info.project.name}`, c.owner)
  const key = `HM${c.tag}`
  await page.request.post('/api/projects', { data: { key, name: '大型專案' } })
  for (let i = 0; i < 300; i += 30) await Promise.all(Array.from({ length: 30 }, (_, j) => page.request.post(`/api/projects/${key}/issues`, { data: { title: `議題 ${i + j + 1}` } })))

  await page.goto(`/projects/${key}?settings=general`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('議題 1', { exact: true }).first()).toBeAttached()
  // Click → next paint for every tab, twice round.
  const times = await page.evaluate(async () => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role=dialog] [role=tab]'))
    const out: number[] = []
    for (const tab of [...tabs, ...tabs]) {
      const t0 = performance.now()
      tab.click()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      out.push(performance.now() - t0)
    }
    return out
  })
  expect(times.length).toBeGreaterThanOrEqual(10)
  expect(Math.max(...times)).toBeLessThan(100)

  // Who can see it: private until someone joins.
  await page.getByRole('tab', { name: '成員' }).click()
  await expect(page.getByText('私人：只有你看得到')).toBeVisible()
  // Add two people at once, one role for both.
  await page.getByRole('button', { name: '加入成員' }).click()
  await page.getByPlaceholder('搜尋成員').fill(c.b)
  await page.getByRole('button', { name: c.b }).click()
  await page.getByPlaceholder('搜尋成員').fill(c.c)
  await page.getByRole('button', { name: c.c }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '加入 2 人' }).click()
  await expect(page.getByText('下方 3 位成員與站台管理員看得到')).toBeVisible()
  const rowB = page.getByRole('dialog').locator('li', { hasText: c.b })
  // Role change shows at once (before the server answers).
  await rowB.getByRole('button', { name: '身分' }).click()
  await expect(page.getByRole('menuitem', { name: /檢視者/ })).toContainText('只能查看')
  await shot(page, info, 'MS-48', 'role-menu')
  const t0 = Date.now()
  await page.getByRole('menuitem', { name: /檢視者/ }).click()
  await expect(rowB.getByRole('button', { name: '身分' })).toHaveText('檢視者')
  expect(Date.now() - t0).toBeLessThan(500)
  // The last owner can't step down: the old role comes back with the reason.
  const rowMe = page.getByRole('dialog').locator('li', { hasText: c.owner })
  await rowMe.getByRole('button', { name: '身分' }).click()
  await page.getByRole('menuitem', { name: /^成員/ }).click()
  await expect(page.getByText('專案至少要有一位擁有者')).toBeVisible()
  await expect(rowMe.getByRole('button', { name: '身分' })).toHaveText('擁有者')
  // Hide from admins.
  await page.getByLabel('對管理員隱藏').click()
  await expect(page.getByLabel('對管理員隱藏')).toBeChecked()
  await expect(page.getByText('僅成員：下方 3 位看得到')).toBeVisible()
  await shot(page, info, 'MS-48', 'members')
  // The tab survives a reload.
  await page.reload()
  await expect(page.getByRole('tab', { name: '成員', selected: true })).toBeVisible()

  // c (member) can create issues; b (now a viewer) sees it without any editing; a stranger gets "not found".
  await cc.page.goto(`/projects/${key}`)
  await expect(cc.page.getByRole('button', { name: '新增', exact: true })).toBeVisible()
  await b.page.goto(`/projects/${key}`)
  await expect(b.page.getByRole('heading', { name: '大型專案' })).toBeVisible()
  await expect(b.page.getByRole('button', { name: '新增', exact: true })).toHaveCount(0)
  expect((await b.page.request.post(`/api/projects/${key}/issues`, { data: { title: 'no' } })).status()).toBe(404)
  const stranger = await newUserPage(browser, info, `hx-${info.project.name}`, `${c.c}2`)
  await stranger.page.goto(`/projects/${key}`)
  await expect(stranger.page.getByText(/找不到/).first()).toBeVisible()
  await shot(b.page, info, 'MS-48', 'viewer')
  await Promise.all([b.ctx.close(), cc.ctx.close(), stranger.ctx.close()])
})

test('sub-projects: create with copied members, tree in the sidebar, breadcrumb and no cycles', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const c = P[info.project.name]!
  const mobile = isMobile(info)
  const b = await newUserPage(browser, info, `sb-${info.project.name}`, `${c.b}子`)
  await login(page, `so-${info.project.name}`, `${c.owner}子`)
  const root = `ST${c.tag}`
  await page.request.post('/api/projects', { data: { key: root, name: '實驗室總專案', members: [{ userId: b.user.id, role: 'member' }] } })
  await page.goto(`/projects/${root}`)
  // New sub-project from the project page.
  await page.getByRole('button', { name: '新增子專案' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('專案名稱').fill('影像辨識')
  await dlg.getByLabel('代號').fill(`${root}A`)
  await expect(dlg.getByLabel('父專案')).toHaveValue(/.+/)
  await expect(dlg.getByLabel('複製上層專案的成員與角色')).toBeChecked()
  await shot(page, info, 'MS-49', 'create')
  await dlg.getByRole('button', { name: '建立' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${root}A$`))
  // Breadcrumb, and b came along as a member.
  await expect(page.getByRole('navigation', { name: '父專案' }).getByRole('link', { name: '實驗室總專案' })).toBeVisible()
  const kid = (await (await page.request.get(`/api/projects/${root}A`)).json()).project
  expect(kid.members.length).toBe(2)
  // A third level, then the sidebar shows the tree and folds it.
  await page.request.post('/api/projects', { data: { key: `${root}B`, name: '資料集整理', parentId: kid.id } })
  await page.goto(`/projects/${root}`)
  await expect(page.getByText('子專案', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`${root}A`) }).first()).toBeVisible()
  if (!mobile) {
    const nav = page.locator('nav[data-tour="pm-nav"]')
    await expect(nav.getByRole('link', { name: new RegExp(`${root}B`) })).toBeVisible()
    await shot(page, info, 'MS-49', 'tree')
    await nav.getByRole('button', { name: '收合子專案' }).first().click()
    await expect(nav.getByRole('link', { name: new RegExp(`${root}B`) })).toHaveCount(0)
    await nav.getByRole('button', { name: '展開子專案' }).first().click()
  } else await shot(page, info, 'MS-49', 'tree')
  // Moving the root under its grandchild is refused.
  const rootId = (await (await page.request.get(`/api/projects/${root}`)).json()).project.id as string
  const grand = (await (await page.request.get(`/api/projects/${root}B`)).json()).project
  const cyc = await page.request.patch(`/api/projects/${root}`, { data: { parentId: grand.id } })
  expect((await cyc.json()).error.code).toBe('cycle')
  // The settings picker never offers its own subtree.
  await page.goto(`/projects/${root}?settings=general`)
  const options = await page.getByLabel('父專案').locator('option').allTextContents()
  expect(options.some((o) => o.includes(`${root}A`) || o.includes(`${root}B`))).toBe(false)
  expect(rootId).toBeTruthy()
  await b.ctx.close()
})

test('blocking: badges both ways, filter, confirm before starting, cycle refused', async ({ page }, info) => {
  test.setTimeout(120_000)
  const c = P[info.project.name]!
  await login(page, `bo-${info.project.name}`, `${c.owner}擋`)
  const key = `BK${c.tag}`
  await page.request.post('/api/projects', { data: { key, name: '阻擋測試' } })
  const mk = async (title: string) => (await (await page.request.post(`/api/projects/${key}/issues`, { data: { title } })).json()).issue as { ref: string }
  const a = await mk('整理資料')
  const bIssue = await mk('訓練模型')
  const z = await mk('寫報告')
  await page.request.post(`/api/issues/${a.ref}/relations`, { data: { type: 'blocks', target: bIssue.ref } })
  await page.request.post(`/api/issues/${bIssue.ref}/relations`, { data: { type: 'blocks', target: z.ref } })
  const cyc = await page.request.post(`/api/issues/${z.ref}/relations`, { data: { type: 'blocks', target: a.ref } })
  expect((await cyc.json()).error.code).toBe('cycle')

  await page.goto(`/projects/${key}`)
  const rowB = page.locator('li', { hasText: '訓練模型' })
  await expect(rowB.getByRole('button', { name: '被阻擋 1' })).toBeVisible()
  await expect(rowB.getByRole('button', { name: '阻擋 1', exact: true })).toBeVisible()
  await shot(page, info, 'MS-50', 'list')
  // Filter.
  await page.getByRole('button', { name: /篩選/ }).click()
  await page.getByLabel('阻擋', { exact: true }).selectOption('blocked')
  await expect(page.locator('li', { hasText: '整理資料' })).toHaveCount(0)
  await expect(page.locator('li', { hasText: '寫報告' })).toBeVisible()
  await expect(page).toHaveURL(/blocking=blocked/)
  // Starting a blocked issue asks first and names the blocker.
  await page.goto(`/projects/${key}/${bIssue.ref}`)
  await expect(page.getByText('被這些議題阻擋')).toBeVisible()
  await expect(page.getByText('正在阻擋這些議題')).toBeVisible()
  await shot(page, info, 'MS-50', 'issue')
  await page.keyboard.press('s')
  await page.getByRole('button', { name: '進行中', exact: true }).click()
  const confirmDlg = page.getByRole('dialog', { name: `${bIssue.ref} 還被阻擋` })
  await expect(confirmDlg).toBeVisible()
  await expect(confirmDlg).toContainText('整理資料')
  await shot(page, info, 'MS-50', 'confirm')
  await confirmDlg.getByRole('button', { name: '取消' }).click()
  await expect(confirmDlg).toBeHidden()
  expect((await (await page.request.get(`/api/issues/${bIssue.ref}`)).json()).issue.status).toBe('todo')
})

test('context menus: project, board column, note, task and comment', async ({ page }, info) => {
  test.setTimeout(120_000)
  const c = P[info.project.name]!
  const mobile = isMobile(info)
  await login(page, `cm-${info.project.name}`, `${c.owner}選`)
  const key = `CM${c.tag}`
  await page.request.post('/api/projects', { data: { key, name: '右鍵選單' } })
  const issue = (await (await page.request.post(`/api/projects/${key}/issues`, { data: { title: '有留言的議題' } })).json()).issue as { ref: string }
  await page.request.post(`/api/issues/${issue.ref}/comments`, { data: { body: '這是一則留言' } })
  const note = (await (await page.request.post('/api/notes', { data: { title: '週會紀錄', startsAt: Date.now() } })).json()).note as { id: string }

  // Project: sidebar on desktop, the project's own sub-project chip area on phones isn't there, so use the sidebar only on desktop.
  if (!mobile) {
    await page.goto(`/projects/${key}`)
    await openMenu(page, page.locator('nav[data-tour="pm-nav"]').getByRole('link', { name: new RegExp(key) }), mobile)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const items = (await menu.getByRole('menuitem').allInnerTexts()).map((x) => x.split(/\s/)[0]!.trim())
    expect(items).toEqual(['開啟', '在新分頁開啟', '新增議題', '新增子專案', '專案設定', '管理成員', '複製連結', '結案', '封存'])
    await shot(page, info, 'MS-51', 'project')
    await page.keyboard.press('Escape')
  }
  // Board column.
  await page.goto(`/projects/${key}?view=board`)
  await openMenu(page, page.locator('[data-column="todo"]').getByRole('button', { name: /Todo|待辦/ }).first(), mobile)
  await expect(page.getByRole('menuitem', { name: '在此欄新增議題' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '收合此欄' })).toBeVisible()
  await page.keyboard.press('Escape')
  // Note card.
  await page.goto('/notes')
  await openMenu(page, page.getByRole('link', { name: /週會紀錄/ }).first(), mobile)
  for (const item of ['開啟', '複製連結', '匯出 ZIP', '刪除']) await expect(page.getByRole('menuitem', { name: new RegExp(item) }).first()).toBeVisible()
  await shot(page, info, 'MS-51', 'note')
  await page.keyboard.press('Escape')
  // Comment.
  await page.goto(`/projects/${key}/${issue.ref}`)
  await openMenu(page, page.getByText('這是一則留言'), mobile)
  await expect(page.getByRole('menu')).toBeVisible()
  expect(await page.getByRole('menu').getByRole('menuitem').allInnerTexts()).toEqual(['回覆', '複製內容', '複製連結', '編輯', '刪除'])
  if (mobile) {
    await page.waitForTimeout(400)
    const m = (await page.getByRole('menu').boundingBox())!
    expect(m.x + m.width).toBeLessThanOrEqual(390)
  }
  await shot(page, info, 'MS-51', 'comment')
  await page.keyboard.press('Escape')
  // Text fields keep the browser's own menu.
  const prevented = await page.getByRole('textbox').last().evaluate((el) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(prevented).toBe(false)
  expect(note.id).toBeTruthy()
})

test('context menus: task card (staff) and attachment', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const c = P[info.project.name]!
  const mobile = isMobile(info)
  await login(page, `ct-${info.project.name}`, `${c.owner}師`)
  // Make this person staff so the task menu offers its settings.
  const admin = await browser.newContext({ baseURL: 'http://localhost:5174' })
  await admin.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  const me = (await (await page.request.get('/api/me')).json()).user.id as string
  await admin.request.patch(`/api/admin/members/${me}`, { data: { role: 'owner' } })
  await admin.close()
  await page.request.post('/api/tasks', { data: { title: `右鍵任務 ${c.tag}` } })
  await page.goto('/tasks')
  await openMenu(page, page.getByRole('link', { name: new RegExp(`右鍵任務 ${c.tag}`) }), mobile)
  await expect(page.getByRole('menu')).toBeVisible()
  expect(await page.getByRole('menu').getByRole('menuitem').allInnerTexts()).toEqual(['開啟', '在新分頁開啟', '複製連結', '排行榜', '編輯任務設定'])
  await page.getByRole('menuitem', { name: '編輯任務設定' }).click()
  await expect(page).toHaveURL(/tab=settings/)

  const key = `CA${c.tag}`
  await page.request.post('/api/projects', { data: { key, name: '附件選單' } })
  const issue = (await (await page.request.post(`/api/projects/${key}/issues`, { data: { title: '有附件' } })).json()).issue as { ref: string }
  await page.goto(`/projects/${key}/${issue.ref}`)
  await page.locator('input[type=file]').first().setInputFiles({ name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') })
  await expect(page.getByRole('button', { name: 'data.csv' })).toBeVisible()
  await openMenu(page, page.getByRole('button', { name: 'data.csv' }), mobile)
  await expect(page.getByRole('menu')).toBeVisible()
  expect(await page.getByRole('menu').getByRole('menuitem').allInnerTexts()).toEqual(['開啟', '下載', '複製連結', '刪除'])
  await shot(page, info, 'MS-51', 'attachment')
})
