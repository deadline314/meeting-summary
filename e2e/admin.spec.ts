import { expect, test } from '@playwright/test'
import { email, newUserPage, shot } from './helpers'

const CAST: Record<string, [string, string]> = {
  'desktop-light': ['賴奕廷', '馮老師'],
  'desktop-dark': ['邱詩涵', '葉老師'],
  'mobile-light': ['潘俊傑', '杜老師'],
  'mobile-dark': ['戴雨萱', '夏老師'],
}

test('admin: activity filters and CSV, member page, usage, site settings', async ({ page, browser }, info) => {
  test.setTimeout(150_000)
  const tag = info.project.name
  const [studentName, teacherName] = CAST[tag]!
  // Teacher = an owner promoted by the deployment owner.
  await page.request.post('/auth/dev', { data: { email: email(`adm-t-${tag}`), name: teacherName } })
  await page.request.patch('/api/me', { data: { onboarded: true } })
  const teacherId = (await (await page.request.get('/api/me')).json()).user.id
  const owner = await newUserPage(browser, info, 'owner-root', '系統老師')
  await owner.page.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  await owner.page.request.patch(`/api/admin/members/${teacherId}`, { data: { role: 'owner' } })
  await owner.ctx.close()

  // Student does a few things: a note, a project issue.
  const st = await newUserPage(browser, info, `adm-s-${tag}`, studentName)
  const note = (await (await st.page.request.post('/api/notes', { data: { title: `${studentName} 的週會`, startsAt: Date.now() } })).json()).note
  await st.page.request.patch(`/api/notes/${note.id}`, { data: { version: note.version, location: '實驗室 301' } })
  const key = `AD${tag.startsWith('desk') ? 'D' : 'M'}${tag.endsWith('light') ? 'L' : 'K'}`
  await st.page.request.post('/api/projects', { data: { key, name: '共享專案' } })
  await st.page.request.post(`/api/projects/${key}/members`, { data: { userId: teacherId, role: 'member' } })
  await st.page.request.post(`/api/projects/${key}/issues`, { data: { title: '整理實驗紀錄', assigneeIds: [st.user.id] } })

  // MS-44: activity filtered by member and module lives in the URL; CSV matches.
  await page.goto(`/admin?tab=activity&actor=${st.user.id}`)
  await expect(page.getByText(new RegExp(`${studentName} 建立了會議紀錄`)).first()).toBeVisible()
  await page.getByLabel('篩選模組').selectOption('issue')
  await expect(page).toHaveURL(/type=issue/)
  await expect(page.getByText(/整理實驗紀錄/).first()).toBeVisible()
  await expect(page.getByText(/建立了會議紀錄/)).toHaveCount(0)
  await shot(page, info, 'MS-44', 'filtered')
  const csv = await (await page.request.get(`/api/admin/activity.csv?actor=${st.user.id}`)).text()
  expect(csv.split('\n')[0]).toContain('time')
  expect(csv).toContain('整理實驗紀錄')

  // Member page.
  await page.goto(`/admin?tab=members&member=${st.user.id}`)
  await expect(page.getByText('近 12 週活動')).toBeVisible()
  await expect(page.getByRole('link', { name: /整理實驗紀錄/ })).toBeVisible()
  await shot(page, info, 'MS-44', 'member')

  // MS-45: usage and settings tabs.
  await page.goto('/admin?tab=usage')
  await expect(page.getByText('檔案儲存')).toBeVisible()
  await shot(page, info, 'MS-45', 'usage')
  await page.goto('/admin?tab=site')
  await page.getByLabel('站台名稱').fill('影像實驗室')
  await page.getByRole('button', { name: 'microscope' }).click()
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('已儲存').first()).toBeVisible()
  await expect(page.getByText('影像實驗室').first()).toBeVisible()
  await shot(page, info, 'MS-45', 'general')
  await page.getByRole('button', { name: '檔案' }).click()
  await page.getByLabel('單檔上限').fill('10')
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('已儲存').first()).toBeVisible()
  await shot(page, info, 'MS-45', 'files')
  // A 20 MB upload is now refused.
  const big = await st.page.request.put(`/api/files?parentType=note&parentId=${note.id}`, {
    headers: { 'x-file-name': 'big.bin', 'content-type': 'application/octet-stream' },
    data: Buffer.alloc(20 * 1024 * 1024),
  })
  expect(big.status()).toBe(413)
  // Settings changes are in the activity feed.
  await page.goto('/admin?tab=activity&type=site')
  await expect(page.getByText(/修改了站台設定/).first()).toBeVisible()
  // Restore the defaults so other specs keep their limits and name.
  await page.request.put('/api/admin/settings/file_limits', { data: { value: { maxFileBytes: 50 * 1024 * 1024, quotaBytes: 1024 * 1024 * 1024 } } })
  await page.request.put('/api/admin/settings/site', { data: { value: { name: '', icon: 'doc' } } })
  await st.ctx.close()
})
