import { test, expect } from '@playwright/test'

/**
 * Cron auth: the shared-secret guard must reject a wrong secret and accept the
 * right one. Runs with no DB dependency for the 401 case.
 */
test.describe('cron auth', () => {
  test('birthday-rebooking rejects a wrong x-cron-secret', async ({ request }) => {
    const res = await request.get('/api/cron/birthday-rebooking', {
      headers: { 'x-cron-secret': 'definitely-wrong' },
    })
    expect(res.status()).toBe(401)
  })

  test('birthday-rebooking accepts the correct secret', async ({ request }) => {
    const secret = process.env.CRON_SECRET
    test.skip(!secret, 'CRON_SECRET not set in this environment')
    const res = await request.get('/api/cron/birthday-rebooking', {
      headers: { 'x-cron-secret': secret! },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty('scanned')
  })
})
