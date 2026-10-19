import type { APIRequestContext, Browser, Page, TestInfo } from '@playwright/test'

export const run = Date.now().toString(36)
export const email = (who: string) => `${who}-${run}@example.com`

/** Signs a page's context in through the local dev login and marks onboarding done. */
export async function login(page: Page, who: string, name: string) {
  await signIn(page.request, who, name)
}

export async function signIn(req: APIRequestContext, who: string, name: string) {
  const r = await req.post('/auth/dev', { data: { email: email(who), name } })
  if (!r.ok()) throw new Error(`dev login failed: ${r.status()}`)
  await req.patch('/api/me', { data: { onboarded: true } })
  return (await (await req.get('/api/me')).json()).user as { id: string }
}

export async function newUserPage(browser: Browser, info: TestInfo, who: string, name: string) {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: 'http://localhost:5174' })
  const page = await ctx.newPage()
  const user = await signIn(page.request, who, name)
  return { page, user, ctx }
}

/** Screenshot for the ticket: images/MS-<n>-<name>-<project>.png. Animations are settled first. */
export async function shot(page: Page, info: TestInfo, ticket: string, name: string) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `pm/meeting-summary/images/${ticket}-${name}-${info.project.name}.png`, animations: 'disabled' })
}

export const isMobile = (info: TestInfo) => info.project.name.startsWith('mobile')

// Distinct people per project (all four projects share one throwaway database).
const CAST: Record<string, [string, string, string]> = {
  'desktop-light': ['林小明', '陳大華', '王老師'],
  'desktop-dark': ['黃怡君', '張志明', '李教授'],
  'mobile-light': ['吳承恩', '周杰倫', '許老師'],
  'mobile-dark': ['蔡依林', '劉德華', '鄭教授'],
}
export const cast = (info: TestInfo) => CAST[info.project.name] ?? ['A', 'B', 'T']

// Separate people for the project-management spec (names must be unique in the shared database).
const CAST_PM: Record<string, [string, string]> = {
  'desktop-light': ['郭雅婷', '何俊宏'],
  'desktop-dark': ['羅美玲', '謝宗翰'],
  'mobile-light': ['曾子涵', '彭冠宇'],
  'mobile-dark': ['簡佩珊', '鍾承翰'],
}
export const castPm = (info: TestInfo) => CAST_PM[info.project.name] ?? ['A', 'B']
