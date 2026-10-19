import { readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'
import { castIns, isMobile, login, shot } from './helpers'

const KEYS: Record<string, [string, string]> = { 'desktop-light': ['INSA', 'THSA'], 'desktop-dark': ['INSB', 'THSB'], 'mobile-light': ['INSC', 'THSC'], 'mobile-dark': ['INSD', 'THSD'] }

async function seed(page: Page, key: string, other: string) {
  const r = page.request
  await r.post('/api/projects', { data: { key, name: '影像分割研究' } })
  await r.post('/api/projects', { data: { key: other, name: '畢業論文' } })
  const label = (await (await r.post(`/api/projects/${key}/labels`, { data: { name: '實驗', color: 3 } })).json()).label
  const mk = async (title: string, o: Record<string, unknown> = {}) => (await (await r.post(`/api/projects/${key}/issues`, { data: { title, ...o } })).json()).issue
  const set = async (ref: string, status: string) => {
    const cur = (await (await r.get(`/api/issues/${ref}`)).json()).issue
    await r.patch(`/api/issues/${ref}`, { data: { version: cur.version, status } })
  }
  const root = await mk('建立資料增強流程', { labelIds: [label.id], priority: 'high', description: '- [ ] 翻轉\n- [ ] 色彩抖動' })
  for (const t of ['實作隨機裁切', '加入 MixUp', '比較增強前後指標']) await mk(t, { parentRef: root.ref })
  const flows: [string, string[], number][] = [
    ['整理 COCO 子集', ['in_progress', 'done'], -6],
    ['訓練 U-Net baseline', ['in_progress', 'in_review', 'done'], -2],
    ['調整損失函數', ['in_progress'], 3],
    ['撰寫相關研究', ['in_progress', 'in_review'], 8],
    ['準備期中報告投影片', [], 12],
  ]
  for (const [title, path, due] of flows) {
    const i = await mk(title, { dueAt: Date.now() + due * 86400_000 })
    for (const s of path) await set(i.ref, s)
  }
  backdate(key)
  return root.ref as string
}

/**
 * Spreads the seeded history over the past weeks so the timeline and insights have real spans.
 * Test-only: writes the throwaway e2e database directly (the app has no way to backdate).
 */
function backdate(key: string) {
  const dir = '.wrangler/e2e/v3/d1/miniflare-D1DatabaseObject'
  const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'))!
  const db = new DatabaseSync(`${dir}/${file}`)
  const D = 86400_000
  const now = Date.now()
  const pid = (db.prepare('select id from projects where key = ?').get(key) as { id: string }).id
  const rows = db.prepare('select id, number from issues where project_id = ? order by number').all(pid) as { id: string; number: number }[]
  rows.forEach((r, i) => {
    const base = now - (24 - i * 2) * D
    const acts = db.prepare('select id from activities where entity_id = ? order by created_at, rowid').all(r.id) as { id: string }[]
    acts.forEach((a, k) => db.prepare('update activities set created_at = ? where id = ?').run(base + k * (3 + (i % 3)) * D, a.id))
    const last = base + Math.max(0, acts.length - 1) * (3 + (i % 3)) * D
    db.prepare('update issues set created_at = ?, status_changed_at = ?, completed_at = case when completed_at is null then null else ? end where id = ?').run(base, last, last, r.id)
  })
  db.prepare('update projects set target_date = ? where id = ?').run(now + 9 * D, pid)
  db.close()
}

test('insights: duplicate, timeline, stats, stale, saved views', async ({ page }, info) => {
  test.setTimeout(150_000)
  const mobile = isMobile(info)
  const [key, other] = KEYS[info.project.name]!
  await login(page, `ins-${info.project.name}`, castIns(info))
  const rootRef = await seed(page, key, other)

  // MS-37: duplicate the tree into the other project; the label has no match there.
  await page.goto(`/projects/${key}/${rootRef}`)
  await page.getByRole('button', { name: '複製議題' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('名稱').fill('建立資料增強流程（論文版）')
  await dlg.getByLabel('複製到專案').selectOption(other)
  await expect(dlg.getByText('目的專案沒有的標籤')).toBeVisible()
  await shot(page, info, 'MS-37', 'dialog')
  await dlg.getByRole('button', { name: '複製', exact: true }).click()
  await page.waitForURL(new RegExp(`/projects/${other}/${other}-1$`))
  await expect(page.getByText('略過標籤：實驗')).toBeVisible()
  await expect(page.getByText(`${other}-4`)).toBeVisible()
  await expect(page.getByRole('link', { name: rootRef })).toBeVisible()
  await shot(page, info, 'MS-37', 'copied')

  // MS-32: timeline at day zoom with hover.
  await page.goto(`/projects/${key}?view=timeline`)
  await expect(page.getByText('訓練 U-Net baseline')).toBeVisible()
  await page.keyboard.press('=')
  await expect(page.getByText('週', { exact: true })).toBeVisible()
  await page.keyboard.press('t')
  if (!mobile) {
    await page.waitForTimeout(600)
    // The ongoing segment ends at today, so it is on screen after T.
    const row = page.locator('div.flex.border-b', { has: page.getByRole('link', { name: /調整損失函數/ }) })
    const bar = row.locator('span.bg-warning.absolute').last()
    const box = (await bar.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByText(/^進行中 · /)).toBeVisible()
  }
  await shot(page, info, 'MS-32', 'timeline')
  await page.goto('/projects/timeline')
  await expect(page.locator('main a', { hasText: '論文版' }).first()).toBeVisible()
  await shot(page, info, 'MS-32', 'overview')

  // MS-40: insights.
  await page.goto(`/projects/${key}?view=stats`)
  await expect(page.getByText('Lead time')).toBeVisible()
  await expect(page.getByText('2 張票').first()).toBeVisible()
  await shot(page, info, 'MS-40', 'stats')

  // Stale: ten days later every unfinished issue carries ⏰ (finished ones don't).
  await page.clock.setFixedTime(Date.now() + 10 * 86400_000)
  await page.goto(`/projects/${key}`)
  await expect(page.locator('li', { hasText: '調整損失函數' }).getByLabel(/已在「進行中」/)).toBeVisible()
  await expect(page.locator('li', { hasText: '整理 COCO 子集' }).getByLabel(/已在/)).toHaveCount(0)
  await shot(page, info, 'MS-40', 'stale')

  // Saved view: high-priority board, restored from the sidebar (desktop) or picker (phone).
  await page.goto(`/projects/${key}?view=board&priority=high`)
  await page.getByRole('button', { name: '儲存檢視' }).click()
  await page.getByRole('dialog').getByLabel('檢視名稱').fill('高優先看板')
  await page.getByRole('dialog').getByRole('button', { name: '儲存' }).click()
  await expect(page.getByText('已儲存檢視「高優先看板」')).toBeVisible()
  await page.goto(`/projects/${key}`)
  if (mobile) await page.getByLabel('專案', { exact: true }).selectOption({ label: '高優先看板' })
  else await page.getByRole('link', { name: '高優先看板' }).click()
  await page.waitForURL(/view=board&priority=high/)
  await shot(page, info, 'MS-40', 'saved-view')
})
