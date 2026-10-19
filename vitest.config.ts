import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    resolve: { alias: { '@shared': '/src/shared' } },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, DEV_LOGIN: 'true', OWNER_EMAILS: 'teacher@example.com', GRADER_MODE: 'local' },
        },
      }),
    ],
    test: { include: ['tests/**/*.test.ts'], setupFiles: ['./tests/setup.ts'] },
  }
})
