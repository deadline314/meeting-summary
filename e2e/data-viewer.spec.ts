import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { email, isMobile, newUserPage, shot } from './helpers'

const P: Record<string, { tag: string; teacher: string; student: string }> = {
  'desktop-light': { tag: 'DL', teacher: '溫老師', student: '江同學' },
  'desktop-dark': { tag: 'DK', teacher: '鄧老師', student: '湯同學' },
  'mobile-light': { tag: 'ML', teacher: '藍老師', student: '紀同學' },
  'mobile-dark': { tag: 'MK', teacher: '柯老師', student: '韓同學' },
}

async function becomeTeacher(page: Page, who: string, name: string) {
  await page.request.post('/auth/dev', { data: { email: email(who), name } })
  await page.request.patch('/api/me', { data: { onboarded: true, prefs: { toursSeen: ['notes', 'tasks', 'projects'] } } })
  const owner = await page.context().browser()!.newContext({ baseURL: 'http://localhost:5174' })
  await owner.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  const id = (await (await page.request.get('/api/me')).json()).user.id
  await owner.request.patch(`/api/admin/members/${id}`, { data: { role: 'owner' } })
  await owner.close()
}

const waitGraded = (page: Page) => expect(page.getByText(/排隊中|執行中/).first()).toBeHidden({ timeout: 120_000 })

test('table submissions: format check with located errors, and a data viewer to explore them', async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  const c = P[info.project.name]!
  const mobile = isMobile(info)
  await becomeTeacher(page, `dv-t-${info.project.name}`, c.teacher)

  // Teacher: a task graded by the BAB-6 validator, accepting CSV and XLSX.
  await page.goto('/tasks')
  await page.getByRole('button', { name: '新增任務' }).first().click()
  await page.waitForURL(/\/tasks\/[\w-]+\?tab=settings/)
  const taskUrl = page.url().split('?')[0]!
  await page.getByLabel('任務名稱').fill(`活動資料來源收集 ${c.tag}`)
  await page.getByLabel('說明（Markdown）').fill('交一份 20 欄的 CSV 或 XLSX，ERROR 要是 0。')
  await page.getByRole('tab', { name: '評測' }).click()
  const grader = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上傳' }).first().click()
  await (await grader).setFiles('examples/tasks/event-sources/grade.py')
  await expect(page.getByText('grade.py', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '提交規則' }).click()
  await page.getByLabel('允許的副檔名').fill('.csv,.xlsx')
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('已儲存').first()).toBeVisible()
  await page.getByRole('tab', { name: '試跑與發布' }).click()
  const trial = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上傳範例提交' }).click()
  await (await trial).setFiles('e2e/fixtures/events_ok.csv')
  await expect(page.getByText('試跑通過', { exact: true })).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: '發布' }).click()
  await expect(page.getByText('已發布，學生現在看得到')).toBeVisible()

  // Student: a file with four mistakes. The card counts them and lists where they are.
  const s = await newUserPage(browser, info, `dv-s-${info.project.name}`, c.student)
  await s.page.goto(taskUrl + '?tab=submit')
  const f = s.page.waitForEvent('filechooser')
  await s.page.getByRole('button', { name: '選擇檔案' }).click()
  await (await f).setFiles('e2e/fixtures/events.csv')
  await waitGraded(s.page)
  await expect(s.page.getByText('ERROR 4｜WARNING 0').first()).toBeVisible()
  await expect(s.page.getByText('錯誤 4').first()).toBeVisible()
  await expect(s.page.getByRole('button', { name: '第 7 列 · 來源網址' })).toBeVisible()
  await shot(s.page, info, 'MS-55', 'card')
  // Clicking a finding opens the viewer on that row with the cell marked.
  await s.page.getByRole('button', { name: '第 7 列 · 來源網址' }).click()
  const dlg = s.page.getByRole('dialog')
  await expect(dlg.getByText('30 筆資料')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByRole('complementary').getByText('第 7 列')).toBeVisible()
  await expect(dlg.getByRole('complementary')).toContainText('必填，不能空白')
  await shot(s.page, info, 'MS-55', 'focus')
  await s.ctx.close()

  // Teacher: the same file from the manage tab, explored with the tools.
  await page.goto(taskUrl + '?tab=manage')
  await page.getByRole('radio', { name: '全部提交' }).or(page.getByRole('button', { name: '全部提交' })).first().click()
  await page.getByRole('button', { name: new RegExp(c.student) }).first().click()
  await page.getByRole('button', { name: '檢視資料' }).first().click()
  const v = page.getByRole('dialog')
  await expect(v.getByText('30 筆資料')).toBeVisible({ timeout: 15_000 })
  await expect(v.getByText('20 個欄位')).toBeVisible()
  await expect(v.getByText('UTF-8')).toBeVisible()
  await expect(v.getByText('符合 30 / 全部 30 筆')).toBeVisible()
  await shot(page, info, 'MS-54', 'viewer')

  // Search across columns.
  await v.getByLabel('搜尋所有欄位').fill('範例活動 05')
  await expect(v.getByText('符合 1 / 全部 30 筆')).toBeVisible()
  await v.getByLabel('搜尋所有欄位').fill('')
  await expect(v.getByText('符合 30 / 全部 30 筆')).toBeVisible()

  // Value filter: only 核心, then everything but 核心.
  await v.getByRole('button', { name: '篩選「範圍判定」' }).click()
  const pop = page.locator('[data-radix-popper-content-wrapper]').last()
  await pop.getByRole('button', { name: /^核心/ }).click()
  await expect(v.getByText('符合 18 / 全部 30 筆')).toBeVisible()
  await shot(page, info, 'MS-54', 'filter')
  await pop.getByRole('radio', { name: '排除' }).click()
  await expect(v.getByText('符合 12 / 全部 30 筆')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(v.getByText('排除 核心')).toBeVisible()

  // Sort by start date, descending: the newest year comes first.
  await v.getByRole('columnheader', { name: /開始日期/ }).getByRole('button').first().click()
  await v.getByRole('columnheader', { name: /開始日期/ }).getByRole('button').first().click()
  await expect(v.getByRole('columnheader', { name: /開始日期/ })).toHaveAttribute('aria-sort', 'descending')

  // Only some columns.
  await v.getByRole('button', { name: /欄位 20\/20/ }).click()
  const cols = page.locator('[data-radix-popper-content-wrapper]').last()
  await cols.getByRole('button', { name: '全部隱藏' }).click()
  for (const name of ['活動名稱', '開始日期', '範圍判定']) await cols.getByLabel(name).check()
  await page.keyboard.press('Escape')
  await expect(v.getByRole('columnheader')).toHaveCount(3)

  // Problem rows only.
  await v.getByLabel('問題篩選').selectOption('issues')
  await expect(v.getByText(/符合 \d+ \/ 全部 30 筆/)).toBeVisible()
  await v.getByRole('button', { name: '清除篩選' }).click()
  await v.getByLabel('問題篩選').selectOption('issues')
  await expect(v.getByText('符合 4 / 全部 30 筆')).toBeVisible()
  await shot(page, info, 'MS-55', 'issues')

  // Export what is shown: UTF-8 with BOM, only the visible columns and rows.
  await v.getByRole('button', { name: '清除篩選' }).click()
  await v.getByRole('button', { name: '篩選「範圍判定」' }).click()
  await page.locator('[data-radix-popper-content-wrapper]').last().getByRole('button', { name: /^周邊/ }).click()
  await page.keyboard.press('Escape')
  const dl = page.waitForEvent('download')
  await v.getByRole('button', { name: '匯出 CSV' }).click()
  const csv = await (await (await dl).createReadStream()).toArray()
  const text = Buffer.concat(csv as Buffer[]).toString('utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.trim().split(/\r?\n/)).toHaveLength(13) // header + 12 周邊 rows

  // Column overview.
  await v.getByRole('tab', { name: '欄位總覽' }).click()
  await expect(v.getByRole('row', { name: /佐證來源數/ })).toContainText('數字')
  await expect(v.getByRole('row', { name: /來源網址/ })).toContainText('1 個問題')
  await shot(page, info, 'MS-54', 'columns')
  await page.keyboard.press('Escape')
  if (mobile) return

  // Performance (desktop): 10,000 rows × 20 columns as a trial submission.
  const big = ['縣市,區域,活動名稱,活動範圍,活動時間,活動編號,開始日期,結束日期,活動時段,活動類型,主辦單位,範圍判定,來源名稱,來源類型,來源網址,佐證來源數,資料可信度,擷取日期,擷取人,備註']
  for (let i = 0; i < 10_000; i++) {
    const d = `20${String(16 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`
    big.push(`高雄市,鹽埕區,大量活動 ${i},真愛碼頭,${d},KHH-YC-${d.slice(0, 4)}-${String(i).padStart(3, '0')},${d},${d},,節慶燈會,未載明,${i % 3 ? '核心' : '周邊'},測試新聞網,新聞媒體,https://example.com/${i},1,中,2026-10-01,測試員,單一來源`)
  }
  await page.goto(taskUrl + '?tab=settings')
  await page.getByRole('tab', { name: '試跑與發布' }).click()
  const bigFile = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上傳範例提交' }).click()
  await (await bigFile).setFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(big.join('\n'), 'utf8') })
  await waitGraded(page)
  const open = Date.now()
  await page.getByRole('button', { name: '檢視資料' }).first().click()
  await expect(page.getByRole('dialog').getByText('10,000 筆資料')).toBeVisible({ timeout: 10_000 })
  const openMs = Date.now() - open
  // Sort and filter: click → next paint, measured in the page.
  const sortMs = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll<HTMLElement>('[role=columnheader] button')).find((b) => b.textContent?.includes('開始日期'))!
    const t0 = performance.now()
    btn.click()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return performance.now() - t0
  })
  // Scrolling: frame times while wheeling through the grid.
  const grid = page.getByRole('dialog').getByRole('grid')
  const box = (await grid.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __f: number[]; __done: Promise<void> }
    w.__f = []
    w.__done = new Promise((res) => {
      let last = performance.now()
      const t0 = last
      const tick = (t: number) => {
        w.__f.push(t - last)
        last = t
        if (t - t0 < 1500) requestAnimationFrame(tick)
        else res()
      }
      requestAnimationFrame(tick)
    })
  })
  // A fast but human scroll: 120 px per wheel tick, one tick per frame.
  for (let k = 0; k < 40; k++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(16)
  }
  await page.evaluate(() => (window as unknown as { __done: Promise<void> }).__done)
  const worst = await page.evaluate(() => Math.max(...(window as unknown as { __f: number[] }).__f.slice(1)))
  console.log(`PERF open=${openMs}ms sort=${Math.round(sortMs)}ms worstFrame=${Math.round(worst)}ms`)
  expect(frames).toBeUndefined()
  expect(openMs).toBeLessThan(1500)
  expect(sortMs).toBeLessThan(100)
  expect(worst).toBeLessThanOrEqual(34)
})

test('a CSV attached to a note opens in the same viewer; phone menus are bottom sheets', async ({ page }, info) => {
  test.setTimeout(120_000)
  const c = P[info.project.name]!
  const mobile = isMobile(info)
  await page.request.post('/auth/dev', { data: { email: email(`dv-a-${info.project.name}`), name: `${c.student}附` } })
  await page.request.patch('/api/me', { data: { onboarded: true, prefs: { toursSeen: ['notes', 'tasks', 'projects'] } } })
  const note = (await (await page.request.post('/api/notes', { data: { title: '附件檢視', startsAt: Date.now() } })).json()).note as { id: string }
  const body = readFileSync('e2e/fixtures/events_ok.csv')
  const up = await page.request.put(`/api/files?parentType=note&parentId=${note.id}`, { headers: { 'x-file-name': 'events_ok.csv', 'content-type': 'text/csv' }, data: body })
  expect(up.status()).toBe(201)
  await page.goto(`/notes/${note.id}?tab=files`)
  if (mobile) {
    // Phones keep the side panel behind a floating button.
    // (it opens on the tab in the URL — files).
    await page.getByRole('button', { name: '歷史' }).click()
  }
  await page.getByRole('button', { name: /events_ok\.csv/ }).first().click()
  const v = page.getByRole('dialog')
  await expect(v.getByText('30 筆資料')).toBeVisible({ timeout: 15_000 })
  await v.getByRole('button', { name: '篩選「範圍判定」' }).click()
  const sheet = page.locator('[data-sheet]').last()
  await expect(sheet).toBeVisible()
  if (mobile) {
    await page.waitForTimeout(400)
    const b = (await sheet.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(390)
    expect(b.y + b.height).toBeGreaterThan(600) // anchored to the bottom
    await shot(page, info, 'MS-54', 'phone-sheet')
  }
})

test("the assignment's own sample files pass on the platform (CSV and XLSX)", async ({ page }, info) => {
  const files = ['examples/tasks/event-sources/sample_events.csv', 'examples/tasks/event-sources/sample_events.xlsx']
  test.skip(info.project.name !== 'desktop-light' || !files.every((f) => existsSync(f)), "needs the teacher's sample files locally (not in the repo)")
  test.setTimeout(240_000)
  await becomeTeacher(page, 'dv-sample-t', '樣本老師')
  await page.goto('/tasks')
  await page.getByRole('button', { name: '新增任務' }).first().click()
  await page.waitForURL(/\/tasks\/[\w-]+\?tab=settings/)
  await page.getByLabel('任務名稱').fill('活動資料（範本檢查）')
  await page.getByRole('tab', { name: '評測' }).click()
  const grader = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上傳' }).first().click()
  await (await grader).setFiles('examples/tasks/event-sources/grade.py')
  await expect(page.getByText('grade.py', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '提交規則' }).click()
  await page.getByLabel('允許的副檔名').fill('.csv,.xlsx')
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('已儲存').first()).toBeVisible()
  await page.getByRole('tab', { name: '試跑與發布' }).click()
  for (const f of files) {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上傳範例提交' }).click()
    await (await chooser).setFiles(f)
    await waitGraded(page)
    await expect(page.getByText('ERROR 0｜').first()).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: '檢視資料' }).first().click()
    await expect(page.getByRole('dialog').getByText('10 筆資料')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog').getByText('20 個欄位')).toBeVisible()
    if (f.endsWith('.xlsx')) {
      await expect(page.getByRole('dialog').getByLabel('工作表')).toBeVisible()
      await shot(page, info, 'MS-56', 'xlsx')
    } else await shot(page, info, 'MS-56', 'csv')
    await page.keyboard.press('Escape')
  }
})
