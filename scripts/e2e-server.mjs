// Fresh local state + migrations, then the dev server on :5174 for Playwright.
import { execSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('.wrangler/e2e', { recursive: true, force: true })
execSync('npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e', { stdio: 'inherit' })
const child = spawn('npx', ['vite', 'dev', '--port', '5174', '--strictPort'], { stdio: 'inherit', shell: true, env: { ...process.env, E2E: '1' } })
// Local grading runner against the e2e server (needs Docker).
const noDocker = (() => {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return false
  } catch {
    return true
  }
})()
const runner = spawn('node', ['scripts/grade.mjs', '--local', '--site', 'http://localhost:5174', ...(noDocker ? ['--no-docker'] : [])], { stdio: 'inherit', env: { ...process.env, LOCAL_RUNNER_TOKEN: 'dev-runner-token' } })
const stop = () => {
  runner.kill()
  child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => process.exit(code ?? 0))
