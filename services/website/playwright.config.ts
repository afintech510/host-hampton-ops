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
 *
 * THE EVITE SPEC (`e2e/evite-*.spec.ts`) IS A DIFFERENT KIND OF RUN. It needs no
 * database and no network: `npm run test:e2e -- evite` starts an in-memory
 * PostgREST (`e2e/support/mock-supabase.mjs`, 127.0.0.1 only) and the PRODUCTION
 * build (`next start`, port 3012, after `npx next build`) pointed at it, with every
 * outbound sender blanked. The other specs are untouched: they never see the evite
 * spec (testIgnore) and the evite run never starts the dev server (which would
 * overwrite `.next`, the build `next start` serves).
 */
const EVITE_RUN = process.env.E2E_EVITE === '1' || process.argv.slice(2).some((a) => /(^|[\/])evite/.test(a))
// Workers are separate processes with their own argv: hand the decision to them through the environment.
if (EVITE_RUN) process.env.E2E_EVITE = '1'
const EVITE_PORT = 3012
const MOCK_PORT = 54399

const eviteServers: Array<{ command: string; url: string; reuseExistingServer: boolean; timeout: number; env: Record<string, string> }> = [
  {
    command: 'node e2e/support/mock-supabase.mjs',
    url: `http://127.0.0.1:${MOCK_PORT}/__health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { MOCK_SUPABASE_PORT: String(MOCK_PORT) },
  },
  {
    command: `npx next start -p ${EVITE_PORT}`,
    url: `http://localhost:${EVITE_PORT}/i/mia-glow-7kq2`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      SUPABASE_SERVICE_KEY: 'e2e-service-key',
      EVITES_PAGES: 'on',
      EVITES_SENDS: 'off',
      EVITES_PILOT_REFS: '',
      PORTAL_LINK_SIGNING_SECRET: 'e2e-only-signing-secret',
      E2E_FAKE_SENDERS: '1',
      // Nothing may leave this machine, whatever the developer's shell or .env.local holds.
      BREVO_API_KEY: '',
      BREVO_BIRTHDAY_CLUB_LIST_ID: '',
      RESEND_API_KEY: '',
      QUO_API_KEY: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      META_CAPI_ACCESS_TOKEN: '',
    },
  },
]

export default defineConfig({
  testDir: './e2e',
  testMatch: EVITE_RUN ? /evite-.*\.spec\.ts$/ : undefined,
  testIgnore: EVITE_RUN ? undefined : /evite-.*\.spec\.ts$/,
  fullyParallel: !EVITE_RUN,
  workers: EVITE_RUN ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: EVITE_RUN ? `http://localhost:${EVITE_PORT}` : process.env.E2E_BASE_URL || 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: EVITE_RUN
    ? eviteServers
    : process.env.E2E_BASE_URL
      ? undefined
      : {
          command: 'npm run dev',
          url: 'http://localhost:3002',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { E2E_FAKE_SENDERS: '1' },
        },
})
