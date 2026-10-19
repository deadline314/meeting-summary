// Fresh local state + migrations, then the dev server on :5174 for Playwright.
import { execSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('.wrangler/e2e', { recursive: true, force: true })
execSync('npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e', { stdio: 'inherit' })
const child = spawn('npx', ['vite', 'dev', '--port', '5174', '--strictPort'], { stdio: 'inherit', shell: true, env: { ...process.env, E2E: '1' } })
const stop = () => child.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => process.exit(code ?? 0))
