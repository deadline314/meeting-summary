import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { ctxOf } from '../context'

export const homeRoutes = new Hono<AppEnv>()

// Each module contributes its slice of the personal dashboard.
homeRoutes.get('/home', async (c) => {
  ctxOf(c)
  return c.json({ notes: [], tasks: [], issues: [] })
})
