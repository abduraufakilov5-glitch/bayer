import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    { command: 'node tests/fixtures/server.mjs', port: 54329, reuseExistingServer: false },
    { command: 'npm run dev -- --hostname 127.0.0.1 --port 3100', port: 3100, timeout: 120000, reuseExistingServer: false,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key', NEXT_TELEMETRY_DISABLED: '1' } },
  ],
})
