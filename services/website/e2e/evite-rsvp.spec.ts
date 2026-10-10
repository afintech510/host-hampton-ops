import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * The guest RSVP flow on a phone (375 x 812): Yes in THREE screens, No in TWO (spec §15).
 *
 * The app under test is the real production build (`next start`). Its database is an in-memory PostgREST on
 * 127.0.0.1 (`e2e/support/mock-supabase.mjs`, started by playwright.config.ts when the run names `evite`), so the
 * whole thing is offline and writes nothing anywhere: there is no test route or flag in the app. The browser is
 * also refused every request that is not to the app itself (no Google, Meta or font CDN traffic).
 *
 * Run it:   cd services/website && npx next build && npm run test:e2e -- evite
 *
 * "Screens" are counted from the `data-screen` attribute the RSVP island puts on each view, observed from
 * before the page's first script runs, so a screen that flashes by is still counted.
 */

const SLUG = 'mia-glow-7kq2'
const MOCK = 'http://127.0.0.1:54399'

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true })
test.describe.configure({ mode: 'serial' })

declare global {
  interface Window {
    __screens: string[]
  }
}

async function state(request: APIRequestContext) {
  const r = await request.get(`${MOCK}/__state`)
  expect(r.ok()).toBe(true)
  return (await r.json()) as Record<string, Array<Record<string, any>>>
}

async function open(page: Page) {
  const base = new URL(test.info().project.use.baseURL ?? 'http://localhost:3012')
  // Nothing but the app itself may be reached from the page.
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin === base.origin || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue()
    return route.abort()
  })
  await page.addInitScript(() => {
    window.__screens = []
    const note = () => {
      const s = document.querySelector('[data-screen]')?.getAttribute('data-screen')
      if (s && window.__screens[window.__screens.length - 1] !== s) window.__screens.push(s)
    }
    new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-screen'] })
  })
  await page.goto(`/i/${SLUG}`)
  await expect(page.getByRole('button', { name: /Yes, we.ll be there/ })).toBeVisible()
}

const screens = (page: Page) => page.evaluate(() => window.__screens)

async function answerYes(page: Page) {
  await page.getByRole('button', { name: /Yes, we.ll be there/ }).click()
  await page.getByLabel('Child 1 first name').fill('Ava')
  await page.locator('#rsvp-parent').fill('Jamie Guest')
  await page.getByRole('group', { name: 'Adults staying' }).getByRole('button', { name: '1', exact: true }).click()
  await page.getByRole('group', { name: 'Food allergy' }).getByRole('button', { name: 'No', exact: true }).click()
  await page.getByRole('button', { name: 'Send my RSVP' }).click()
  await expect(page.getByRole('heading', { name: /on the list/i })).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  const r = await request.post(`${MOCK}/__reset`)
  expect(r.ok()).toBe(true)
})

test('the invitation fits a 375px phone and offers the two answers', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: /Can.t make it/ })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // screens 1-2 mention no offers or marketing
  await expect(page.getByText(/Birthday Club/i)).toHaveCount(0)
})

test('Yes takes three screens, answers with this RSVP only, and sets an HttpOnly edit cookie', async ({ page, request, context }) => {
  await open(page)
  const posted = page.waitForResponse((r) => r.url().includes(`/api/i/${SLUG}/rsvp`) && r.request().method() === 'POST')
  await answerYes(page)
  const res = await posted
  expect(res.status()).toBe(200)

  expect(await screens(page)).toEqual(['1', '2', '3'])

  // E2, end to end: the answer is the caller's own columns, never an id, nonce, IP or contact link.
  const body = await res.json()
  expect(body.ok).toBe(true)
  for (const private_ of ['id', 'evite_id', 'edit_nonce', 'consent_ip', 'contact_id', 'opt_in_text_version']) {
    expect(Object.keys(body.rsvp)).not.toContain(private_)
  }
  expect(body.rsvp.children).toEqual([{ first_name: 'Ava' }])

  const cookie = (await context.cookies()).find((c) => c.name.startsWith('hh_rsvp_'))
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Lax')
  expect(cookie?.path).toBe('/')

  const db = await state(request)
  expect(db.evite_rsvps).toHaveLength(1)
  expect(db.evite_rsvps[0]).toMatchObject({ status: 'yes', parent_name: 'Jamie Guest', adult_count: 1, has_allergy: false })
  expect(db.evite_rsvps[0].club_opt_in_at ?? null).toBeNull()
  // Screens 1-3 touched no contact.
  expect(db.contacts).toHaveLength(0)
})

test('No takes two screens and asks for a name only', async ({ page, request }) => {
  await open(page)
  await page.getByRole('button', { name: /Can.t make it/ }).click()
  await expect(page.getByLabel('Child 1 first name')).toHaveCount(0)
  await page.locator('#rsvp-parent').fill('Pat Away')
  await page.getByRole('button', { name: 'Let them know' }).click()
  await expect(page.getByRole('heading', { name: 'Thanks for letting us know' })).toBeVisible()

  expect(await screens(page)).toEqual(['1', '2'])
  await expect(page.locator('[data-screen="3"]')).toHaveCount(0)

  const db = await state(request)
  expect(db.evite_rsvps).toHaveLength(1)
  expect(db.evite_rsvps[0]).toMatchObject({ status: 'no', parent_name: 'Pat Away', adult_count: 0 })
  expect(db.evite_rsvps[0].children).toEqual([])
})

test('Birthday Club (P10): a new address becomes a lead contact with both opt-ins false, linked to the RSVP; leaving is recorded', async ({ page, request }) => {
  await open(page)
  await answerYes(page)

  // The wording on screen is the database row's, next to an UNCHECKED box.
  const box = page.locator('#rsvp-club')
  await expect(box).not.toBeChecked()
  await expect(page.getByText('Send me party & craft ideas from Host Hampton')).toBeVisible()
  await expect(page.getByText('Unsubscribe anytime.')).toBeVisible()

  await box.check()
  await page.locator('#rsvp-club-email').fill('Club.Guest@Example.com')
  await page.locator('#rsvp-club-month').selectOption('6')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/You.re signed up/)).toBeVisible()

  // The consent lives on the RSVP row; the contact is created by the (fire-and-forget) hook.
  await expect
    .poll(async () => {
      const db = await state(request)
      return db.contacts.length === 1 && db.evite_rsvps[0].contact_id === db.contacts[0].id
    }, { timeout: 10_000 })
    .toBe(true)

  const db = await state(request)
  expect(db.evite_rsvps[0]).toMatchObject({ club_email: 'Club.Guest@Example.com', opt_in_text_version: 'club-v1', birthday_month: 6 })
  expect(db.evite_rsvps[0].club_opt_in_at).toBeTruthy()
  expect(db.evite_rsvps[0].club_opted_out_at ?? null).toBeNull()
  expect(db.contacts[0]).toMatchObject({
    email: 'Club.Guest@Example.com', // as typed
    first_name: 'Jamie',
    last_name: 'Guest',
    source: 'evite',
    source_detail: `evite:${SLUG}`,
    status: 'lead',
    email_opt_in: false,
    sms_opt_in: false,
  })

  await page.getByRole('button', { name: 'Leave the Birthday Club' }).click()
  await expect(page.locator('#rsvp-club')).toBeVisible()
  const after = await state(request)
  expect(after.evite_rsvps[0].club_opted_out_at).toBeTruthy()
  expect(after.contacts).toHaveLength(1)
  expect(after.contacts[0].email_opt_in).toBe(false)
})
