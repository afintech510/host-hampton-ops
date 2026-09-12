/**
 * The non-plan money branches of `/api/webhook`, driven against a fake that
 * refuses what Postgres refuses (`helpers/fakeMoneyDb.ts`).
 *
 * Every case here is a defect that was live in production on 2026-09-12, on
 * branches that have really run: 77 ticket payments, 11 carts, 10 bundles,
 * 2 vendor registrations, 1 gift card.
 */

import { makeFakeMoneyDb, type FakeMoneyDb } from '../helpers/fakeMoneyDb'

const mockConstructEvent = jest.fn()
const mockResendSend = jest.fn().mockResolvedValue({ id: 'email_1' })

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  webhooks: { constructEvent: mockConstructEvent },
})))
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

let db: FakeMoneyDb
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockImplementation(() => db.client),
}))

jest.mock('@/lib/contacts', () => ({ upsertContact: jest.fn().mockResolvedValue('contact-1') }))
jest.mock('@/lib/sequences', () => ({ enrollInSequence: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/reminders', () => ({
  enqueueEventReminders: jest.fn().mockResolvedValue(undefined),
  enqueueBookingReminders: jest.fn().mockResolvedValue(undefined),
  enqueueReviewRequest: jest.fn().mockResolvedValue(undefined),
  enqueuePartyReminders: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/googleCalendar', () => ({
  createCalendarEvent: jest.fn().mockResolvedValue('cal_1'),
  addMinutes: (t: string) => t,
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: () => body, body }),
  },
}))

const EVENT_ID = '11111111-1111-1111-1111-111111111111'
const SESSION_ID = '22222222-2222-2222-2222-222222222222'

function seed() {
  return makeFakeMoneyDb({
    events: [{ id: EVENT_ID, title: 'Embroidery Workshop', event_date: '2026-10-01', event_time: '2:00 PM', location: 'Host Hampton', available_tickets: 10 }],
    event_sessions: [{ id: SESSION_ID, event_id: EVENT_ID, session_date: '2026-10-01', session_time: '2:00 PM', label: 'Morning', available_tickets: 4 }],
  })
}

function req() {
  return {
    text: jest.fn().mockResolvedValue('raw'),
    headers: { get: (n: string) => (n === 'stripe-signature' ? 'sig' : n === 'host' ? 'www.hosthampton.com' : null) },
  } as never
}

function session(over: Record<string, unknown> = {}) {
  return {
    id: 'cs_live_probe_1',
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 5601,
    currency: 'usd',
    payment_intent: 'pi_probe_1',
    customer_details: { email: 'adam@easternbuilding.supply', name: 'Adam' },
    metadata: {},
    ...over,
  }
}

function fire(over: Record<string, unknown> = {}, type = 'checkout.session.completed') {
  mockConstructEvent.mockReturnValue({ type, data: { object: session(over) } })
}

/** Emails sent to anyone who is NOT the owner — the unclaimed net legitimately alerts Adam. */
const customerEmails = () => mockResendSend.mock.calls
  .map(c => String((c[0] as { to?: string }).to ?? ''))
  .filter(to => !to.includes('hosthampton295'))

async function post() {
  const { POST } = await import('@/app/api/webhook/route')
  return POST(req())
}

const TICKET_META = {
  type: 'event_ticket',
  eventId: EVENT_ID,
  sessionId: '',
  quantity: '2',
  customerName: 'Adam',
  customerEmail: 'adam@easternbuilding.supply',
  customerPhone: '+16314008080',
}

const originalEnv = process.env
beforeEach(() => {
  jest.clearAllMocks()
  db = seed()
  process.env = {
    ...originalEnv,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-key',
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'noReply@mail.hosthampton.com',
  }
})
afterAll(() => { process.env = originalEnv })

/* ───────────────────────────────────────────────── idempotency (redelivery) ── */

describe('Stripe redelivers — and used to be paid for twice', () => {
  it('a redelivered event_ticket issues ONE ticket, ONE financial row, TWO emails total', async () => {
    fire({ metadata: TICKET_META })
    expect((await post()).status).toBe(200)

    expect(db.count('event_tickets')).toBe(1)
    expect(db.count('financial_transactions')).toBe(1)
    expect(mockResendSend).toHaveBeenCalledTimes(2)   // customer + owner
    expect(db.rows('events')[0].available_tickets).toBe(8)

    // Same event, again — exactly what Stripe does when a delivery times out.
    mockResendSend.mockClear()
    fire({ metadata: TICKET_META })
    const second = await post()

    expect(second.status).toBe(200)
    expect(second.json()).toMatchObject({ duplicate: true })
    expect(db.count('event_tickets')).toBe(1)
    expect(db.count('financial_transactions')).toBe(1)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(db.rows('events')[0].available_tickets).toBe(8)   // not decremented twice
  })

  it('a redelivered gift card does not mint a second code, or email one', async () => {
    const GC = {
      type: 'gift_card', amountCents: '5000',
      purchaserName: 'Adam', purchaserEmail: 'adam@easternbuilding.supply',
      recipientName: 'Pat', recipientEmail: 'pat@example.com',
    }
    fire({ metadata: GC })
    expect((await post()).status).toBe(200)
    expect(db.count('gift_cards')).toBe(1)
    const firstCode = db.rows('gift_cards')[0].code
    expect(mockResendSend).toHaveBeenCalledTimes(3)   // recipient + purchaser + owner

    mockResendSend.mockClear()
    fire({ metadata: GC })
    const second = await post()

    expect(second.json()).toMatchObject({ duplicate: true })
    expect(db.count('gift_cards')).toBe(1)
    expect(db.rows('gift_cards')[0].code).toBe(firstCode)
    // The old code generated a FRESH code, failed the unique insert on
    // `stripe_session_id`, and emailed the recipient that code anyway — a second
    // gift-card email quoting a code that redeems nothing.
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('a redelivered vendor registration does not create a second booking', async () => {
    const V = { type: 'vendor_registration', contactName: 'Adam', contactEmail: 'adam@easternbuilding.supply', businessName: 'EBS', igHandle: '@ebs' }
    fire({ metadata: V })
    await post()
    expect(db.count('bookings')).toBe(1)

    mockResendSend.mockClear()
    fire({ metadata: V })
    const second = await post()
    expect(second.json()).toMatchObject({ duplicate: true })
    expect(db.count('bookings')).toBe(1)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('a redelivered cart re-issues nothing, and a PARTIAL delivery is completed', async () => {
    const cart = [
      { e: EVENT_ID, q: 1, p: 2801, t: 'Embroidery Workshop' },
      { e: EVENT_ID, s: SESSION_ID, q: 1, p: 2801, t: 'Embroidery Workshop' },
    ]
    fire({ metadata: { type: 'cart_checkout', cartItems: JSON.stringify(cart), customerName: 'Adam', customerEmail: 'adam@easternbuilding.supply' } })
    await post()
    expect(db.count('event_tickets')).toBe(2)

    // Simulate a delivery that died after the first row: drop the second ticket
    // and redeliver. The claim must NOT stop the retry from finishing the job.
    db.tables.event_tickets.pop()
    mockResendSend.mockClear()
    fire({ metadata: { type: 'cart_checkout', cartItems: JSON.stringify(cart), customerName: 'Adam', customerEmail: 'adam@easternbuilding.supply' } })
    const second = await post()

    expect(second.json()).toMatchObject({ duplicate: true })
    expect(db.count('event_tickets')).toBe(2)          // the missing line was created
    expect(mockResendSend).not.toHaveBeenCalled()      // but nobody was emailed twice
  })
})

/* ─────────────────────────────────────────────────────── the settlement gate ── */

describe('`completed` does not mean paid', () => {
  it.each(['unpaid', undefined])('issues nothing for payment_status=%s', async (ps) => {
    fire({ payment_status: ps, metadata: TICKET_META })
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ settled: false })
    expect(db.count('event_tickets')).toBe(0)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('issues the ticket when the delayed payment later succeeds', async () => {
    fire({ payment_status: 'unpaid', metadata: TICKET_META })
    await post()
    expect(db.count('event_tickets')).toBe(0)

    fire({ payment_status: 'paid', metadata: TICKET_META }, 'checkout.session.async_payment_succeeded')
    const res = await post()
    expect(res.status).toBe(200)
    expect(db.count('event_tickets')).toBe(1)
  })

  it('says so when the delayed payment fails, and issues nothing', async () => {
    fire({ payment_status: 'unpaid', metadata: TICKET_META }, 'checkout.session.async_payment_failed')
    const res = await post()
    expect(res.json()).toMatchObject({ failed: true })
    expect(db.count('event_tickets')).toBe(0)
  })
})

/* ───────────────────────────────────────────── rule 14: none of the above ── */

describe('a type nobody wrote a branch for', () => {
  it('is recorded as unclaimed, not turned into a phantom kids party', async () => {
    // `invoice_deposit` is real: a settled LIVE session from 2026-07-22 for
    // $250.00 carried it, and it is in no table in this database.
    fire({ amount_total: 25000, metadata: { type: 'invoice_deposit', customerName: 'A Real Customer' } })
    const res = await post()

    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ unclaimed: true, unknownType: 'invoice_deposit' })
    expect(db.count('bookings')).toBe(0)
    expect(db.rows('financial_transactions')[0].category).toBe('Unmatched Stripe Payment')
  })

  it('is STILL caught when the session carries a contact email', async () => {
    // This is the hole `isUnclaimableSession` left: it asked "can the legacy tail
    // cope", not "did any branch claim this". With an email present the answer
    // was yes, and a phantom `deposit_paid` booking was created — with a
    // "You're booked!" email sent to whoever paid.
    fire({ amount_total: 25000, metadata: { type: 'invoice_deposit', contactEmail: 'adam@easternbuilding.supply', contactName: 'Adam' } })
    const res = await post()

    expect(res.json()).toMatchObject({ unclaimed: true, unknownType: 'invoice_deposit' })
    expect(db.count('bookings')).toBe(0)
    expect(mockResendSend).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'adam@easternbuilding.supply' }))
  })

  it('still lets a genuinely metadata-less legacy booking through', async () => {
    // The legacy tail is not dead — 10 real bookings came through it. A session
    // with NO type at all is the shape it was written for.
    fire({
      amount_total: 25000,
      metadata: { contactName: 'Adam', contactEmail: 'adam@easternbuilding.supply', contactPhone: '+16314008080', partyDate: '2026-10-01', partyTime: '14:00', depositCents: '25000' },
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(db.count('bookings')).toBe(1)
    expect(db.rows('bookings')[0].status).toBe('deposit_paid')
  })
})

/* ─────────────────────────────────────────────────── rule 10's expensive half ── */

describe('nothing claims success over a write that did not happen', () => {
  it('does not email "You\'re in!" when the ticket insert fails', async () => {
    // Force a NOT NULL violation: no customer_email in the metadata.
    fire({ metadata: { ...TICKET_META, customerEmail: undefined } })
    const res = await post()

    expect(res.status).toBe(500)          // so Stripe redelivers
    expect(db.count('event_tickets')).toBe(0)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('does not email the vendor when the booking insert is refused', async () => {
    // `bookings_contact_reachable_check` — the constraint that ate $927.
    fire({ metadata: { type: 'vendor_registration', contactName: 'Adam', businessName: 'EBS', igHandle: '@ebs' } })
    const res = await post()

    expect(res.status).toBe(500)
    expect(db.count('bookings')).toBe(0)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('records the money and does NOT email when the legacy booking is refused', async () => {
    // No contactEmail AND no contactPhone: the exact $927 session shape, but
    // with a partyDate so it reaches the legacy tail rather than the net.
    fire({ amount_total: 92700, metadata: { contactName: 'Real Customer', partyDate: '2026-10-01' } })
    const res = await post()

    expect(res.status).toBe(200)                        // acknowledged, not a 500 loop
    expect(res.json()).toMatchObject({ unclaimed: true })
    expect(db.count('bookings')).toBe(0)
    expect(db.rows('financial_transactions').some(r => r.category === 'Unmatched Stripe Payment')).toBe(true)
  })

  it('does not email a bundle receipt when none of the sessions exist', async () => {
    fire({
      metadata: {
        type: 'event_ticket_multi', eventId: EVENT_ID,
        sessionIds: JSON.stringify(['33333333-3333-3333-3333-333333333333']),
        quantity: '1', unitPriceCents: '2801',
        customerName: 'Adam', customerEmail: 'adam@easternbuilding.supply',
      },
    })
    const res = await post()
    expect(res.json()).toMatchObject({ unclaimed: true })
    expect(db.count('event_tickets')).toBe(0)
    expect(customerEmails()).toEqual([])   // Adam IS emailed: that is the alert
  })
})

/* ──────────────────────────────────────────────────────────── rule 12 (reads) ── */

describe('a failed read is not an answer', () => {
  it('does not proceed when the redelivery check cannot be made', async () => {
    // Breaks `gift_cards`, NOT `event_tickets`, deliberately.
    //
    // The first version of this test broke `event_tickets` and asserted 500 —
    // and it passed even with the claim's `unavailable` branch disabled, because
    // the ticket INSERT then failed on the same broken table and 500'd for a
    // different reason. The attack script found that: a test green for the wrong
    // reason is a test that proves nothing.
    //
    // `gift_cards` is read only by the claim, so if the claim stops refusing, the
    // handler sails on and issues the ticket — which is what this asserts.
    db.breakReadsOn('gift_cards')
    fire({ metadata: TICKET_META })
    const res = await post()
    expect(res.status).toBe(500)
    expect(db.count('event_tickets')).toBe(0)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('never marks a booking paid_in_full off a failed bookings read', async () => {
    // The old code read `bkRow?.total_cents || 0`, so a read failure made the
    // total zero, which makes the balance zero, which writes `paid_in_full`.
    db.tables.bookings.push({ id: 'bk1', booking_ref: 'HH-TEST-X', total_cents: 100000, status: 'deposit_paid', contact_email: 'adam@easternbuilding.supply' })
    db.breakReadsOn('bookings')
    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_x', amount: 25000, metadata: { type: 'party_builder', booking_ref: 'HH-TEST-X', booking_id: 'bk1', payment_type: 'deposit', depositCents: '25000' } } },
    })
    const res = await post()

    expect(res.status).toBe(500)
    expect(db.rows('bookings')[0].status).toBe('deposit_paid')
    expect(db.rows('bookings')[0].paid_in_full_at).toBeUndefined()
  })
})

/* ─────────────────────────────────────────────────────── inventory + gift cards ── */

describe('inventory and gift cards say what they did', () => {
  it('issues the ticket but reports an OVERSELL rather than silently not decrementing', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {})
    db.tables.events[0].available_tickets = 1
    fire({ metadata: TICKET_META })                    // quantity 2, only 1 left
    const res = await post()

    expect(res.status).toBe(200)
    expect(db.count('event_tickets')).toBe(1)          // the money was taken; the ticket stands
    expect(db.rows('events')[0].available_tickets).toBe(1)
    expect(warn.mock.calls.flat().join(' ')).toContain('OVERSOLD')
    warn.mockRestore()
  })

  it('redeems a gift card once, clamped to its balance, without clearing redeemed_at', async () => {
    db.tables.gift_cards.push({ code: 'HH-TEST-CARD', amount_cents: 4000, balance_cents: 4000, purchaser_name: 'A', purchaser_email: 'a@example.com', status: 'active', redeemed_at: null })

    fire({ metadata: { ...TICKET_META, giftCardCode: 'HH-TEST-CARD', giftCardDeductCents: '4000' } })
    await post()
    const card = db.rows('gift_cards')[0]
    expect(card.balance_cents).toBe(0)
    expect(card.status).toBe('redeemed')
    const stamp = card.redeemed_at
    expect(stamp).toBeTruthy()

    // A second purchase quoting the same spent card must not go negative, and
    // must not blank the timestamp — the old code wrote `redeemed_at: null` on
    // any redemption that did not zero the balance.
    db.tables.event_tickets.length = 0
    fire({ id: 'cs_live_probe_2', payment_intent: 'pi_probe_2', metadata: { ...TICKET_META, giftCardCode: 'HH-TEST-CARD', giftCardDeductCents: '1000' } })
    await post()
    expect(db.rows('gift_cards')[0].balance_cents).toBe(0)
    expect(db.rows('gift_cards')[0].redeemed_at).toBe(stamp)
  })

  it('says so when a gift card cannot be redeemed at all', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    fire({ metadata: { ...TICKET_META, giftCardCode: 'HH-NO-SUCH', giftCardDeductCents: '1000' } })
    await post()
    expect(err.mock.calls.flat().join(' ')).toContain('GIFT CARD NOT REDEEMED')
    err.mockRestore()
  })
})

/* ───────────────────────────────────────────────────────────── ticket refs ── */

describe('ticket references', () => {
  it('come from the sequence, not from the clock', async () => {
    fire({ metadata: TICKET_META })
    await post()
    const ref = String(db.rows('event_tickets')[0].ticket_ref)
    // Migration 046 starts the sequence at 10000, so refs are five digits and
    // structurally disjoint from the legacy four-digit space (max 9932).
    expect(ref).toMatch(/^HH-EVT-\d{5,}$/)
    expect(db.log).toContain('RPC nextval_event_ticket_seq')
  })

  it('two cart lines for the same event do not collide', async () => {
    // The old ref was `Date.now().slice(-4)` + the event id prefix, computed
    // inside a tight loop: two lines for one event landed on the same
    // millisecond and produced the same ref against a UNIQUE column.
    const cart = [
      { e: EVENT_ID, q: 1, v: 'Adult', p: 2801, t: 'Embroidery Workshop' },
      { e: EVENT_ID, q: 1, v: 'Child', p: 2801, t: 'Embroidery Workshop' },
    ]
    fire({ metadata: { type: 'cart_checkout', cartItems: JSON.stringify(cart), customerName: 'Adam', customerEmail: 'adam@easternbuilding.supply' } })
    const res = await post()

    expect(res.status).toBe(200)
    expect(db.count('event_tickets')).toBe(2)
    const refs = db.rows('event_tickets').map(r => r.ticket_ref)
    expect(new Set(refs).size).toBe(2)
  })
})

/* ────────────────────────────────────────────────────────── cart metadata ── */

describe('cart metadata', () => {
  it('reads the LEGACY long-key form, because sessions created before the fix are still payable', async () => {
    const legacy = [{ eventId: EVENT_ID, quantity: 1, unitPriceCents: 2801, eventTitle: 'Embroidery Workshop' }]
    fire({ metadata: { type: 'cart_checkout', cartItems: JSON.stringify(legacy), customerName: 'Adam', customerEmail: 'adam@easternbuilding.supply' } })
    const res = await post()
    expect(res.status).toBe(200)
    expect(db.count('event_tickets')).toBe(1)
    expect(db.rows('event_tickets')[0].event_id).toBe(EVENT_ID)
  })

  it('does not throw out of the handler on malformed JSON', async () => {
    fire({ metadata: { type: 'cart_checkout', cartItems: '{not json', customerName: 'Adam', customerEmail: 'adam@easternbuilding.supply' } })
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ unclaimed: true })
    expect(customerEmails()).toEqual([])   // Adam IS emailed: that is the alert
  })
})
