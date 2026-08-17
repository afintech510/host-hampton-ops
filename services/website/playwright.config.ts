import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config. Runs specs in ./e2e against the Next dev server on
 * :3002. External senders are stubbed via E2E_FAKE_SENDERS=1 (Twilio logs
 * instead of texting; Resend/SignWell are simply left unconfigured), so a run
 * never sends a real message.
 *
 * Specs that touch the DB assume a reachable Supabase with migrations
 * 020–023 applied and the Southampton seed present (starting_plan/). In CI,
 * point SUPABASE_URL/SUPABASE_SERVICE_KEY at a throwaway branch.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3002',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { E2E_FAKE_SENDERS: '1' },
      },
})
