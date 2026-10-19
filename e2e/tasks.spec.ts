import { expect, test, type Page } from '@playwright/test'
import { cast, email, isMobile, newUserPage, shot } from './helpers'

async function becomeTeacher(page: Page, who: string, name: string) {
  await page.request.post('/auth/dev', { data: { email: email(who), name } })
  await page.request.patch('/api/me', { data: { onboarded: true } })
  const owner = await page.context().browser()!.newContext({ baseURL: 'http://localhost:5174' })
  await owner.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  const id = (await (await page.request.get('/api/me')).json()).user.id
  await owner.request.patch(`/api/admin/members/${id}`, { data: { role: 'owner' } })
  await owner.close()
}

/** Waits until attempt `n` (or any trial) has appeared and finished grading. */
async function waitResult(page: Page, n?: number) {
  if (n) await expect(page.getByRole('button', { name: new RegExp(`^第 ${n} 次`) })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/排隊中|執行中/).first()).toBeHidden({ timeout: 120_000 })
}

test('tasks: author, trial, publish, submit, grade, leaderboard', async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  const tag = info.project.name
  const mobile = isMobile(info)
  const [studentName, rivalName, teacherName] = cast(info)
  await becomeTeacher(page, `t-${tag}`, teacherName)

  // Teacher creates a task.
  await page.goto('/tasks')
  await page.getByRole('button', { name: '新增任務' }).first().click()
  await page.waitForURL(/\/tasks\/[\w-]+\?tab=settings/)
  const taskUrl = page.url().split('?')[0]!
  await page.getByLabel('任務名稱').fill(`作業一：加法函式 ${tag}`)
  await page.getByLabel('說明（Markdown）').fill('## 題目\n請在 `solution.py` 實作 `add(a, b)`，回傳兩數相加。\n\n- 只能上傳 `.py`\n- 全部測試通過才算通過')
  await shot(page, info, 'MS-21', 'settings-basic')
  await page.getByRole('tab', { name: '評測' }).click()
  const grader = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上傳' }).first().click()
  await (await grader).setFiles('e2e/fixtures/grade.py')
  await expect(page.getByText('grade.py', { exact: true })).toBeVisible()
  await page.getByLabel('時間上限（秒）').fill('20')
  await shot(page, info, 'MS-21', 'settings-grading')
  await page.getByRole('tab', { name: '提交規則' }).click()
  await page.getByLabel('允許的副檔名').fill('.py')
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('已儲存').first()).toBeVisible()

  // Trial run with a correct sample, then publish.
  await page.getByRole('tab', { name: '試跑與發布' }).click()
  await expect(page.getByRole('button', { name: '發布' })).toBeDisabled()
  const trial = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上傳範例提交' }).click()
  await (await trial).setFiles('e2e/fixtures/good.py')
  await expect(page.getByText(/排隊中|執行中|通過/).first()).toBeVisible({ timeout: 20_000 })
  await waitResult(page)
  await expect(page.getByText('試跑通過', { exact: true })).toBeVisible({ timeout: 60_000 })
  await shot(page, info, 'MS-21', 'trial')
  await page.getByRole('button', { name: '發布' }).click()
  await expect(page.getByText('已發布，學生現在看得到')).toBeVisible()

  // A student sees it and submits a wrong solution, then a correct one.
  const s = await newUserPage(browser, info, `s-${tag}`, studentName)
  await s.page.goto('/tasks')
  await expect(s.page.getByText(`作業一：加法函式 ${tag}`)).toBeVisible()
  await shot(s.page, info, 'MS-22', 'list')
  await s.page.goto(taskUrl + '?tab=submit')
  const f1 = s.page.waitForEvent('filechooser')
  await s.page.getByRole('button', { name: '選擇檔案' }).click()
  await (await f1).setFiles('e2e/fixtures/bad.py')
  await waitResult(s.page, 1)
  await expect(s.page.getByText('通過 3/4 個測試').first()).toBeVisible()
  await shot(s.page, info, 'MS-22', 'failed')
  const f2 = s.page.waitForEvent('filechooser')
  await s.page.getByRole('button', { name: '選擇檔案' }).click()
  await (await f2).setFiles('e2e/fixtures/good.py')
  await waitResult(s.page, 2)
  await expect(s.page.getByText('全部通過').first()).toBeVisible()
  await shot(s.page, info, 'MS-24', 'history')

  // An infinite loop hits the time limit.
  if (!mobile) {
    const f3 = s.page.waitForEvent('filechooser')
    await s.page.getByRole('button', { name: '選擇檔案' }).click()
    await (await f3).setFiles('e2e/fixtures/loop.py')
    await waitResult(s.page, 3)
    await expect(s.page.getByText('執行超過 20 秒上限').first()).toBeVisible()
    await shot(s.page, info, 'MS-23', 'timeout')
  }

  // A rival also passes → leaderboard.
  const r = await newUserPage(browser, info, `r-${tag}`, rivalName)
  const code = 'def add(a, b):\n    return b + a\n'
  await r.page.request.post(`${taskUrl.replace(/.*\/tasks\//, '/api/tasks/')}/submissions`, {
    headers: { 'x-file-name': 'solution.py', 'content-type': 'text/x-python' },
    data: code,
  })
  await s.page.goto(taskUrl + '?tab=leaderboard')
  await expect(s.page.getByRole('cell', { name: new RegExp(rivalName) })).toBeVisible({ timeout: 120_000 })
  await shot(s.page, info, 'MS-24', 'leaderboard')

  // Teacher overview.
  await page.goto(taskUrl + '?tab=manage')
  await expect(page.getByText('每人最佳成績')).toBeVisible()
  await shot(page, info, 'MS-24', 'manage')
  await s.ctx.close()
  await r.ctx.close()
})
