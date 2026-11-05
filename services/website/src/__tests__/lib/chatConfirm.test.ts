/**
 * What the "Book it & see my invoice" tap does (lib/chat/confirm.ts).
 *
 * The planner's save route, the invoice loader, the mailer and the calendar are
 * faked; the card, the session store and the quote engine are real.
 */
import { FALLBACK_CATALOG } from '@/lib/pricingCatalog'
import { buildQuoteItems } from '@/lib/quoteEngine'
import { quoteFromCatalog, type LoadedCatalog } from '@/lib/quoteRequest'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import { ChatDb, sessionRow } from '../helpers/fakeChatDb'

const item = (id: string, name: string, category: string, price_cents: number): PricingItem => ({
  id, name, description: null, category, price_cents, price_label: null, price_type: 'flat', is_popular: false, sort_order: 0, emoji: null,
})
let glowPrice = 85000
const catalog = (): LoadedCatalog => {
  const groups = {
    themes: [item('00000000-0000-4000-8000-000000000001', 'Glow Party', 'party-theme', glowPrice)],
    premiumActivities: [item('00000000-0000-4000-8000-000000000002', 'Slime Making', 'activity-premium', 0)],
    standardActivities: [], food: [], desserts: [item('00000000-0000-4000-8000-000000000005', 'Cupcakes', 'dessert-add-on', 3000)],
    beverages: [], decor: [], entertainment: [], partyAddOns: [],
  }
  return { cat: FALLBACK_CATALOG, groups, items: buildQuoteItems(groups) }
}

let catalogReadable = true
jest.mock('@/lib/quoteRequest', () => ({
  ...jest.requireActual('@/lib/quoteRequest'),
  loadQuoteCatalog: async () => (catalogReadable ? { kind: 'ok', data: catalog() } : { kind: 'unavailable', error: 'down' }),
}))
const savePlan = jest.fn()
jest.mock('@/app/api/party-builder/save/route', () => ({ POST: (r: unknown) => savePlan(r) }))
const mintPortalLink = jest.fn()
jest.mock('@/lib/portalLinkMint', () => ({ mintPortalLink: (...a: unknown[]) => mintPortalLink(...a) }))
const loadPlanInvoice = jest.fn()
jest.mock('@/lib/planInvoice', () => ({ loadPlanInvoice: (...a: unknown[]) => loadPlanInvoice(...a) }))
const sendPlanSummaryEmail = jest.fn()
jest.mock('@/lib/planShare', () => ({ sendPlanSummaryEmail: (...a: unknown[]) => sendPlanSummaryEmail(...a) }))
const dateIsOpen = jest.fn()
jest.mock('@/lib/chat/tools', () => ({
  dateIsOpen: (...a: unknown[]) => dateIsOpen(...a),
  usd: (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`,
}))

import { confirmBooking } from '@/lib/chat/confirm'
import { mintCard, type BookingCard } from '@/lib/chat/card'
import { loadSession, type ChatSession } from '@/lib/chat/session'

const REQ = new Request('https://www.example.com/api/chat/confirm', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.7', cookie: 'hh_portal=SOMEONE-ELSES' } })

function cardFor(sid: string, over: Partial<BookingCard> = {}) {
  const ans = quoteFromCatalog(catalog(), { partyType: 'studio', guests: 10, theme: 'Glow Party', activities: ['Slime Making'], addOns: ['Cupcakes'] })
  if (!ans.ok) throw new Error('fixture quote failed')
  return mintCard({
    sid,
    contact: { name: 'Pat Example', email: 'pat@example.com', phone: '631-555-0100' },
    date: '2026-12-12', time: '14:00', childName: 'Sam', childAge: 7,
    selection: { theme: 'Glow Party', guests: 10, mini: false, activities: ['Slime Making'], addOns: ['Cupcakes'] },
    guestsPriced: ans.quote.effectiveGuestCount,
    lineItems: ans.quote.lineItems,
    totalCents: ans.quote.totalCents,
    depositCents: 24500,
    ...over,
  })
}

let db: ChatDb
let session: ChatSession
async function freshSession(over: Record<string, unknown> = {}) {
  db = new ChatDb()
  const row = sessionRow(over)
  db.sessions().push(row)
  const loaded = await loadSession(db as never, row.id as string)
  if (loaded.kind !== 'found') throw new Error('fixture session')
  session = loaded.session
}

beforeEach(async () => {
  jest.clearAllMocks()
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret'
  glowPrice = 85000
  catalogReadable = true
  await freshSession()
  dateIsOpen.mockResolvedValue('open')
  savePlan.mockResolvedValue(new Response(JSON.stringify({ ok: true, bookingRef: 'HH-PTY-TEST1', bookingId: 'booking-1' }), {
    status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'hh_portal=abc; Path=/' },
  }))
  mintPortalLink.mockResolvedValue({ ok: true, url: 'https://www.example.com/api/portal/auth?ref=HH-PTY-TEST1&token=t&redirect=%2Fplan%2FHH-PTY-TEST1%2Fsummary', expiresAt: new Date() })
  loadPlanInvoice.mockResolvedValue({ ok: true, invoice: { booking: { booking_ref: 'HH-PTY-TEST1' } } })
  sendPlanSummaryEmail.mockResolvedValue({ ok: true })
})

const run = (cardToken: unknown, now?: number) => confirmBooking({ supabase: db as never, req: REQ, session, cardToken, now })

describe('a valid card', () => {
  it('REPLAYS the planner save route, mints the invoice link, emails it, and links the transcript', async () => {
    const { token, card } = cardFor(session.id)
    const r = await run(token)
    expect(r).toMatchObject({ ok: true, bookingRef: 'HH-PTY-TEST1', emailedTo: 'pat@example.com', emailSent: true, total: '$980' })

    // The planner's own route got the SERVER's line items and the card's contact — in-process.
    expect(savePlan).toHaveBeenCalledTimes(1)
    const req = savePlan.mock.calls[0][0] as Request
    expect(new URL(req.url).pathname).toBe('/api/party-builder/save')
    const sent = await req.json()
    expect(sent.lineItems).toEqual(card.lineItems)
    expect(sent).toMatchObject({
      contactName: 'Pat Example', contactEmail: 'pat@example.com', partyDate: '2026-12-12', partyTime: '14:00',
      packageType: 'Glow Party', marketingConsent: false, attribution: { utm_source: 'website-chat' },
    })
    // The visitor's portal cookie is NOT forwarded: it must not decide which plan this edits.
    expect(req.headers.get('cookie')).toBeNull()
    expect(req.headers.get('cf-connecting-ip')).toBe('203.0.113.7')

    expect(mintPortalLink).toHaveBeenCalledWith(db, 'booking-1', 'HH-PTY-TEST1', '/plan/HH-PTY-TEST1/summary')
    expect(sendPlanSummaryEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'pat@example.com', url: expect.stringContaining('/api/portal/auth') }))

    const row = db.sessions()[0]
    expect(row).toMatchObject({ status: 'booked', booking_ref: 'HH-PTY-TEST1', booking_id: 'booking-1', contact_email: 'pat@example.com' })
    expect(r.ok && r.setCookie).toBe('hh_portal=abc; Path=/')
  })

  it('a booking whose invoice link cannot be minted is still reported, with no link and no email', async () => {
    mintPortalLink.mockResolvedValue({ ok: false, reason: 'insert refused' })
    const r = await run(cardFor(session.id).token)
    expect(r).toMatchObject({ ok: true, invoiceUrl: null, emailSent: false })
    expect(sendPlanSummaryEmail).not.toHaveBeenCalled()
  })

  it('a failed email is reported so the widget can say so', async () => {
    sendPlanSummaryEmail.mockResolvedValue({ ok: false, reason: 'bounced' })
    expect(await run(cardFor(session.id).token)).toMatchObject({ ok: true, emailSent: false })
  })
})

describe('refusals (and the planner is NEVER called)', () => {
  it('an unsigned, expired, other-session or ALTERED card', async () => {
    const { token } = cardFor(session.id)
    expect(await run('not-a-card')).toMatchObject({ ok: false, reason: 'malformed' })
    expect(await run(undefined)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(await run(token, Date.now() + 31 * 60_000)).toMatchObject({ ok: false, reason: 'expired', status: 410 })
    expect(await run(cardFor('22222222-2222-4222-8222-222222222222').token)).toMatchObject({ ok: false, reason: 'wrong_session' })

    const [payload, sig] = token.split('.')
    const obj = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    obj.totalCents = 100
    obj.lineItems[0].unit_price_cents = 1
    const forged = `${Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`
    expect(await run(forged)).toMatchObject({ ok: false, reason: 'bad_signature' })

    expect(savePlan).not.toHaveBeenCalled()
    expect(db.sessions()[0].claimed_card_id).toBeNull()
  })

  it('a REUSED card — the second tap books nothing', async () => {
    const { token } = cardFor(session.id)
    expect(await run(token)).toMatchObject({ ok: true })
    expect(await run(token)).toMatchObject({ ok: false, reason: 'already_used' })
    expect(savePlan).toHaveBeenCalledTimes(1)
  })

  it('a second card in a chat that has already booked', async () => {
    await freshSession({ booking_ref: 'HH-PTY-OLD01' })
    expect(await run(cardFor(session.id).token)).toMatchObject({ ok: false, reason: 'already_booked' })
    expect(savePlan).not.toHaveBeenCalled()
  })

  it('a durable claim from another container (the in-memory set was reset by a deploy)', async () => {
    await freshSession({ claimed_card_id: 'someone-elses-claim' })
    expect(await run(cardFor(session.id).token)).toMatchObject({ ok: false, reason: 'already_used' })
    expect(savePlan).not.toHaveBeenCalled()
  })

  it('PRICES that changed since the card was made — even though the signature is perfect', async () => {
    const { token } = cardFor(session.id)
    glowPrice = 90000
    expect(await run(token)).toMatchObject({ ok: false, reason: 'price_changed', status: 409 })
    expect(savePlan).not.toHaveBeenCalled()
  })

  it('a price list that cannot be read is not "unchanged"', async () => {
    const { token } = cardFor(session.id)
    catalogReadable = false
    expect(await run(token)).toMatchObject({ ok: false, reason: 'prices_unavailable', status: 503 })
    expect(savePlan).not.toHaveBeenCalled()
  })

  it('a date that was taken since, or that cannot be checked, is checked AGAIN and refused', async () => {
    const { token } = cardFor(session.id)
    dateIsOpen.mockResolvedValue('blocked')
    expect(await run(token)).toMatchObject({ ok: false, reason: 'date_taken' })
    dateIsOpen.mockResolvedValue('unknown')
    expect(await run(token)).toMatchObject({ ok: false, reason: 'calendar_unavailable' })
    expect(dateIsOpen).toHaveBeenCalledWith('2026-12-12', expect.anything())
    expect(savePlan).not.toHaveBeenCalled()
    // Nothing was claimed, so the visitor can tap again once the calendar answers.
    dateIsOpen.mockResolvedValue('open')
    expect(await run(token)).toMatchObject({ ok: true })
  })
})

describe('when the planner route refuses', () => {
  it('releases both claims so the visitor can tap again, and passes on a customer-safe 4xx', async () => {
    savePlan.mockResolvedValueOnce(Response.json({ error: 'This party already has a payment on it.' }, { status: 409 }))
    const { token } = cardFor(session.id)
    const r = await run(token)
    expect(r).toMatchObject({ ok: false, reason: 'save_refused', message: 'This party already has a payment on it.' })
    expect(mintPortalLink).not.toHaveBeenCalled()
    expect(sendPlanSummaryEmail).not.toHaveBeenCalled()
    expect(db.sessions()[0]).toMatchObject({ claimed_card_id: null, booking_ref: null, status: 'active' })
    expect(await run(token)).toMatchObject({ ok: true })
  })

  it('a 500 or a throw is "nothing was booked", never an echoed error', async () => {
    savePlan.mockResolvedValueOnce(Response.json({ error: 'duplicate key value violates unique constraint "bookings_pkey"' }, { status: 500 }))
    const r = await run(cardFor(session.id).token)
    expect(r).toMatchObject({ ok: false, status: 503 })
    expect(!r.ok && r.message).not.toMatch(/constraint/)
    savePlan.mockRejectedValueOnce(new Error('boom'))
    expect(await run(cardFor(session.id).token)).toMatchObject({ ok: false, reason: 'save_refused' })
    expect(db.sessions()[0].claimed_card_id).toBeNull()
  })

  it('a 200 with no booking ref is not a booking', async () => {
    savePlan.mockResolvedValueOnce(Response.json({ ok: true }))
    expect(await run(cardFor(session.id).token)).toMatchObject({ ok: false })
    expect(mintPortalLink).not.toHaveBeenCalled()
  })
})
