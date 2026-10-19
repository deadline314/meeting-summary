import { expect, test, type Page } from '@playwright/test'
import { castPm, isMobile, login, newUserPage, shot } from './helpers'

const KEYS: Record<string, string> = { 'desktop-light': 'LABA', 'desktop-dark': 'LABB', 'mobile-light': 'LABC', 'mobile-dark': 'LABD' }

async function createIssue(page: Page, title: string, o: { priority?: string } = {}) {
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('議題標題').fill(title)
  if (o.priority) {
    await dlg.getByRole('button', { name: '優先級' }).click()
    await page.getByRole('button', { name: o.priority, exact: true }).click()
  }
  await dlg.getByRole('button', { name: '建立', exact: true }).click()
  await expect(page.getByText(/^已建立 /).first()).toBeVisible()
}

test('projects: create, members, issues, list, board, detail', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const tag = info.project.name
  const mobile = isMobile(info)
  const key = KEYS[tag]!
  const [aliceName, bobName] = castPm(info)
  await login(page, `pm-a-${tag}`, aliceName)
  const bob = await newUserPage(browser, info, `pm-b-${tag}`, bobName)

  // Empty state → create project.
  await page.goto('/projects')
  await expect(page.getByText('還沒有專案')).toBeVisible()
  await shot(page, info, 'MS-26', 'empty')
  await page.getByRole('button', { name: '新增專案' }).last().click()
  await page.getByLabel('專案名稱').fill('影像辨識研究')
  await page.getByLabel('代號').fill(key)
  await page.getByRole('dialog').getByRole('button', { name: '建立' }).click()
  await page.waitForURL(new RegExp(`/projects/${key}$`))
  await expect(page.getByText('這個專案還沒有議題')).toBeVisible()

  // Add Bob → project becomes shared.
  await page.getByRole('button', { name: '專案設定' }).click()
  await page.getByRole('tab', { name: '成員' }).click()
  await page.getByRole('button', { name: '加入成員' }).click()
  await page.getByRole('button', { name: bobName }).click()
  await expect(page.getByText('專案變為共享')).toBeVisible()
  await page.keyboard.press('Escape')
  await shot(page, info, 'MS-26', 'members')
  await page.keyboard.press('Escape')

  // Issues.
  await createIssue(page, '整理資料集並切分 train/val', { priority: '高' })
  await createIssue(page, '訓練 baseline 模型')
  await createIssue(page, '撰寫實驗報告')
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('議題標題').fill('調整學習率排程')
  await shot(page, info, 'MS-29', 'create')
  // Esc with text → three-choice draft prompt.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await shot(page, info, 'MS-29', 'draft-prompt')
  await page.getByRole('button', { name: '保留草稿' }).click()
  await page.getByRole('button', { name: '新增', exact: true }).first().click()
  await expect(page.getByText('已還原上次未送出的草稿')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '建立', exact: true }).click()

  // Inline status change in the list.
  const row = page.locator('li', { hasText: '訓練 baseline 模型' })
  await row.getByRole('button', { name: '狀態' }).click()
  await page.getByRole('button', { name: '進行中', exact: true }).click()
  await expect(page.locator('section', { hasText: '進行中' }).locator('li', { hasText: '訓練 baseline 模型' })).toBeVisible()
  await shot(page, info, 'MS-30', 'list')

  // Detail: sub-issue, relation (blocks), comment.
  await page.locator('li', { hasText: '整理資料集並切分' }).getByText('整理資料集並切分').click()
  await page.waitForURL(new RegExp(`/projects/${key}/${key}-1$`))
  await page.getByRole('button', { name: '新增子議題' }).click()
  await page.getByLabel('新增子議題，按 Enter 建立').fill('清理標註錯誤')
  await page.keyboard.press('Enter')
  await expect(page.getByText('清理標註錯誤')).toBeVisible()
  await page.getByRole('button', { name: '建立關聯' }).click()
  await page.getByLabel('建立關聯').selectOption('blocks')
  await page.getByLabel('輸入議題編號或標題').fill('實驗報告')
  await page.getByRole('button', { name: /撰寫實驗報告/ }).click()
  await expect(page.getByText('擋住').first()).toBeVisible()
  await page.getByPlaceholder(/留言…/).fill('資料集已上傳到 Drive，請 @ 大家確認格式')
  await page.getByRole('button', { name: '送出' }).click()
  await expect(page.getByText('資料集已上傳到 Drive').first()).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, info, 'MS-33', 'detail')

  // The blocked issue shows the warm prefix in the list.
  await page.goto(`/projects/${key}`)
  await expect(page.locator('li', { hasText: '撰寫實驗報告' }).getByText('整理資料集並切分').first()).toBeVisible()
  await shot(page, info, 'MS-34', 'blocked-prefix')

  // Board + drag (desktop).
  await page.goto(`/projects/${key}?view=board`)
  await expect(page.getByText('撰寫實驗報告').first()).toBeVisible()
  if (!mobile) {
    const card = page.locator('[data-ref]', { hasText: '撰寫實驗報告' }).first()
    await card.dragTo(page.locator('[data-column="in_review"]'))
    // The folded "In review" column opens once it holds an issue.
    await page.reload()
    await expect(page.locator('[data-column="in_review"] [data-ref]', { hasText: '撰寫實驗報告' })).toBeVisible()
    await page.evaluate(() => document.querySelector('[data-column]')?.parentElement?.scrollTo(0, 0))
  }
  await shot(page, info, 'MS-31', 'board')

  // Bob sees the shared project; an outsider gets 404.
  await bob.page.goto(`/projects/${key}/${key}-1`)
  await expect(bob.page.getByRole('heading', { name: '整理資料集並切分 train/val' })).toBeVisible()
  const out = await newUserPage(browser, info, `pm-o-${tag}`, 'Outsider')
  await out.page.goto(`/projects/${key}`)
  await expect(out.page.getByText('找不到這個項目')).toBeVisible()
  await out.ctx.close()

  // My issues: assign self via the detail page, then check the inbox.
  await page.goto(`/projects/${key}/${key}-2`)
  if (mobile) await page.locator('details summary').click()
  await page.getByRole('button', { name: '負責人', exact: true }).click()
  await page.getByRole('button', { name: aliceName }).click()
  await page.keyboard.press('Escape')
  await page.goto('/projects')
  await expect(page.getByText('訓練 baseline 模型')).toBeVisible()
  await shot(page, info, 'MS-39', 'my-issues')

  // Notifications: Alice assigns Bob; Bob's bell shows it and opens the issue.
  const i3 = await (await page.request.get(`/api/issues/${key}-3`)).json()
  await page.request.patch(`/api/issues/${key}-3`, { data: { version: i3.issue.version, assigneeIds: [bob.user.id] } })
  await bob.page.goto('/')
  await expect(bob.page.getByRole('button', { name: '通知' }).first()).toContainText('1')
  await bob.page.getByRole('button', { name: '通知' }).first().click()
  await expect(bob.page.getByText(/指派給你/)).toBeVisible()
  await shot(bob.page, info, 'MS-41', 'bell')
  await bob.page.getByText(/指派給你/).click()
  await bob.page.waitForURL(new RegExp(`/projects/${key}/${key}-3$`))
  await bob.ctx.close()
})
