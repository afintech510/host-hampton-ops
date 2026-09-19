/**
 * `POST /api/admin/parties/[id]` with `action: 'record_payment'` — the button
 * Allie presses when a customer hands her cash at the party.
 *
 * Measured on the live database before any of this was written:
 *
 *   booking_payments recorded_by='admin'  : 12 rows, $2,652.00
 *   …with NO financial_transactions row   :  8 rows, $2,256.00
 *   …of which not a card                  :  5 rows, $1,608.00
 *   financial_transactions with
 *     source in ('cash','other'), ever    :  0
 *
 * The `source` CHECK has permitted `'cash'` and `'other'` since the table
 * existed and there is no trigger on it, so the table would always have taken
 * these rows. Rule 17 asked properly: this is not "never ran" and not "could not
 * have run" — the code path did not exist.
 *
 * Driven against `fakeMoneyDb`, which carries the real CHECKs (including
 * migration 047's relaxed `recorded_by`), the real unique index on
 * `(source, reference)`, and real filter semantics.
 */

import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const mockResendSend = jest.fn().mockResolvedValue({ error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

jest.mock('@/lib/adminAuth', () => ({
  ...jest.requireActual('@/lib/adminAuth'),
  isAdminAuthorized: jest.fn(() => true),
}))

jest.mock('@/lib/googleCalendar', () => ({
  createCalendarEvent: jest.fn(), addMinutes: jest.fn(() => '12:00'),
  updateCalendarEvent: jest.fn(), deleteCalendarEvent: jest.fn(),
}))
jest.mock('@/lib/checkinReminders', () => ({
  enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn(),
}))
jest.mock('@/lib/emailTemplates', () => ({
  partyApprovedHtml: () => '<html></html>',
  partyChangesRequestedHtml: () => '<html></html>',
  partyPortalMagicLinkHtml: () => '<html></html>',
  partyPaymentReceivedHtml: jest.fn(() => '<html>receipt</html>'),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }) },
}))

import { POST } from '@/app/api/admin/parties/[id]/route'
import { partyPaymentReceivedHtml } from '@/lib/emailTemplates'

const BK = 'bbbbbbbb-0000-4000-8000-000000000001'

function bookingRow(over: Record<string, unknown> = {}) {
  return {
    id: BK,
    booking_ref: 'HH-PTY-TEST1',
    status: 'approved',
    contact_name: 'Test Customer',
    contact_email: 'adam@easternbuilding.supply',
    event_type: 'kid-party',
    party_type: 'kid_party',
    total_cents: 60000,
    balance_due_cents: 60000,
    paid_in_full_at: null,
    party_date: '2026-12-01',
    party_time: '10:00',
    ...over,
  }
}

function db(over: Record<string, unknown> = {}, seedFin: Record<string, unknown>[] = []) {
  return makeFakeMoneyDb({
    bookings: [bookingRow(over)],
    booking_payments: [],
    financial_transactions: seedFin,
    booking_modifications: [],
    portal_tokens: [],
  })
}

let body: any
const req = () => ({ headers: { get: () => null }, json: async () => body }) as any
const params = Promise.resolve({ id: BK })

beforeEach(() => {
  jest.clearAllMocks()
  body = { action: 'record_payment', amount_cents: 16300, payment_method: 'venmo' }
  process.env.RESEND_API_KEY = 're_test'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-secret'
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('record_payment — the money reaches the books', () => {
  it('writes the payment row, the ledger row, and names the human', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)

    expect(d.rows('booking_payments')).toHaveLength(1)
    const pay = d.rows('booking_payments')[0]
    expect(pay.amount_cents).toBe(16300)
    expect(pay.payment_method).toBe('venmo')
    // `adminActorId` on the shared-password path. Before migration 047 the
    // CHECK was IN ('system','admin') and refused BOTH spellings this returns.
    expect(pay.recorded_by).toBe('ADMIN')

    const fin = d.rows('financial_transactions')
    expect(fin).toHaveLength(1)
    expect(fin[0].amount_cents).toBe(16300)
    expect(fin[0].source).toBe('other')       // Venmo is not Stripe and not cash
    expect(fin[0].category).toBe('Party Booking')
    expect(fin[0].reference).toBe(`admin-bp-${pay.id}`)
    expect(res.json().ledger).toBe('recorded')
  })

  it('literal cash is sourced `cash`; the CHECK permits it and always did', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 81300, payment_method: 'cash', notes: 'cash at party' }

    await POST(req(), { params })
    expect(d.rows('financial_transactions')[0].source).toBe('cash')
  })

  it('a studio rental is categorised Room Rental, like the webhook does it', async () => {
    const d = db({ party_type: 'studio_rental', event_type: 'room-rental' })
    mockGetSupabase.mockReturnValue(d.client)
    await POST(req(), { params })
    expect(d.rows('financial_transactions')[0].category).toBe('Room Rental')
  })
})

describe('record_payment — it must not double-count', () => {
  it('declines when a Stripe row already records this amount for this booking', async () => {
    // The live shape: four of the twelve admin rows are a human re-typing a $99
    // Stripe deposit the webhook had already recorded as `stripe-bk-<ref>`.
    const d = db({}, [{
      id: 'f1', date: '2026-07-11', description: 'Kids Party Deposit — Spa Party',
      amount_cents: 9900, source: 'stripe', category: 'Party Booking',
      customer_name: 'Test Customer', reference: 'stripe-bk-HH-PTY-TEST1',
    }])
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 9900, payment_method: 'card' }

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json().ledger).toBe('already-in-books')
    // The payment row is still written — the human really did see that money —
    // but the books are not touched twice.
    expect(d.rows('booking_payments')).toHaveLength(1)
    expect(d.rows('financial_transactions')).toHaveLength(1)
    expect(res.json().message).toMatch(/already records this amount/)
  })

  it('records a DIFFERENT amount for the same booking', async () => {
    const d = db({}, [{
      id: 'f1', date: '2026-07-11', description: 'Deposit', amount_cents: 9900,
      source: 'stripe', category: 'Party Booking', customer_name: 'X',
      reference: 'stripe-bk-HH-PTY-TEST1',
    }])
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 81300, payment_method: 'cash' }

    const res: any = await POST(req(), { params })
    expect(res.json().ledger).toBe('recorded')
    expect(d.rows('financial_transactions')).toHaveLength(2)
  })

  it('`force_ledger` overrides the coverage check', async () => {
    const d = db({}, [{
      id: 'f1', date: '2026-07-11', description: 'Deposit', amount_cents: 9900,
      source: 'stripe', category: 'Party Booking', customer_name: 'X',
      reference: 'stripe-bk-HH-PTY-TEST1',
    }])
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 9900, payment_method: 'card', force_ledger: true }

    const res: any = await POST(req(), { params })
    expect(res.json().ledger).toBe('recorded')
    expect(d.rows('financial_transactions')).toHaveLength(2)
  })

  it('a failed ledger READ does not record — the direction that double-counts', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    d.breakReadsOn('financial_transactions')

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json().ledger).toBe('failed')
    expect(res.json().message).toMatch(/will not appear in reporting/)
    expect(d.rows('financial_transactions')).toHaveLength(0)
  })
})

describe('record_payment — it must not lie about what it did', () => {
  it('a REFUSED payment insert is a 500, with no receipt email', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    // A payment type the CHECK forbids, forced past the route's own validation
    // by the only field that reaches the column unvalidated in the old code.
    body = { action: 'record_payment', amount_cents: 16300, payment_method: 'venmo', payment_type: 'partial' }
    // Break the write by making the CHECK fail: an unknown method is refused by
    // the route, so instead break the table read the insert needs.
    d.breakReadsOn('booking_payments')

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(500)
    expect(res.json().error).toMatch(/Payment NOT recorded/)
    // The old code emailed "Payment Received — $163.00, balance $437.00" here.
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(d.rows('financial_transactions')).toHaveLength(0)
  })

  it('an UNQUOTED LEAD is not marked paid in full by its first deposit', async () => {
    // The defect: `Math.max(0, (booking.total_cents || 0) - paid)` is 0 for a
    // lead with a null total, and `newBalance === 0` wrote status paid_in_full
    // and stamped paid_in_full_at. Most of the pipeline is leads since Phase 4.
    const d = db({ status: 'lead', total_cents: null, balance_due_cents: null })
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 10000, payment_method: 'venmo' }

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    const bk = d.rows('bookings')[0]
    expect(bk.status).toBe('lead')
    expect(bk.paid_in_full_at ?? null).toBeNull()
  })

  it('marks paid_in_full when the total really is covered', async () => {
    const d = db({ total_cents: 16300 })
    mockGetSupabase.mockReturnValue(d.client)

    await POST(req(), { params })
    const bk = d.rows('bookings')[0]
    expect(bk.status).toBe('paid_in_full')
    expect(bk.balance_due_cents).toBe(0)
    expect(bk.paid_in_full_at).toBeTruthy()
  })

  it('reports an OVERPAYMENT rather than clamping it silently', async () => {
    const d = db({ total_cents: 10000 })
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 15000, payment_method: 'zelle' }

    const res: any = await POST(req(), { params })
    expect(res.json().message).toMatch(/OVERPAID by \$50\b/)
    expect(d.rows('bookings')[0].balance_due_cents).toBe(0)
  })

  it('a failed balance read leaves the balance alone and SAYS so', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    // sanity: the happy path updated it
    expect(d.rows('bookings')[0].balance_due_cents).toBe(43700)

    const d2 = db()
    mockGetSupabase.mockReturnValue(d2.client)
    // Break the payments read the balance depends on, AFTER the insert path.
    const realFrom = d2.client.from
    let inserted = false
    ;(d2.client as any).from = (t: string) => {
      if (t === 'booking_payments' && inserted) d2.breakReadsOn('booking_payments')
      if (t === 'booking_payments') inserted = true
      return realFrom(t)
    }
    const res2: any = await POST(req(), { params })
    expect(res2.status).toBe(200)
    expect(res2.json().balanceUpdated).toBe(false)
    expect(res2.json().message).toMatch(/Balance NOT recalculated/)
    expect(d2.rows('bookings')[0].balance_due_cents).toBe(60000)
  })

  it('does not mail a portal link whose token row was refused', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    d.breakReadsOn('portal_tokens')

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
    // The payment itself still stands.
    expect(d.rows('booking_payments')).toHaveLength(1)
    expect(d.rows('financial_transactions')).toHaveLength(1)
  })
})

describe('record_payment — input validation', () => {
  it.each([
    [{ amount_cents: 0, payment_method: 'cash' }, /positive whole number/],
    [{ amount_cents: -500, payment_method: 'cash' }, /positive whole number/],
    [{ amount_cents: 12.5, payment_method: 'cash' }, /positive whole number/],
    [{ amount_cents: '100', payment_method: 'cash' }, /positive whole number/],
    [{ amount_cents: 100, payment_method: 'bitcoin' }, /payment_method must be one of/],
    [{ amount_cents: 100, payment_method: 'CASH' }, /payment_method must be one of/],
  ])('refuses %p', async (patch: any, re: RegExp) => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', ...patch }

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(400)
    expect(res.json().error).toMatch(re)
    expect(d.rows('booking_payments')).toHaveLength(0)
    expect(d.rows('financial_transactions')).toHaveLength(0)
  })

  it('an unknown payment_type falls back to partial rather than being refused by the DB', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'record_payment', amount_cents: 100, payment_method: 'cash', payment_type: 'nonsense' }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(d.rows('booking_payments')[0].payment_type).toBe('partial')
  })
})

describe('the POST gate: a failed read is 503, not a confident 404', () => {
  it('answers 503 when the booking read fails', async () => {
    const d = db()
    d.breakReadsOn('bookings')
    mockGetSupabase.mockReturnValue(d.client)

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(503)
    expect(d.rows('booking_payments')).toHaveLength(0)
  })

  it('still answers 404 for a booking that genuinely is not there', async () => {
    const d = makeFakeMoneyDb({ bookings: [] })
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(404)
  })
})

describe('the receipt', () => {
  it('quotes the recalculated balance, and goes out once', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    await POST(req(), { params })
    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(partyPaymentReceivedHtml).toHaveBeenCalledWith(
      expect.objectContaining({ amountFormatted: '$163', newBalanceFormatted: '$437' }),
    )
  })

  /**
   * `send_receipt: false` — money that arrived weeks ago, written down now to
   * make the books right. HH-PTY-SHS6V is the booking that needed it: a
   * "Payment Received" mail for a July payment reads as a second charge.
   *
   * The assertion that matters is `mockResendSend`. A flag that is accepted,
   * echoed back as `receiptSent: false`, and then mails the customer anyway is
   * the worst outcome available here — it reports success over the exact thing
   * it was asked to prevent.
   */
  it('sends NOTHING when send_receipt is false, and still records the money', async () => {
    body = { ...body, send_receipt: false }
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)

    const res: any = await POST(req(), { params })

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(partyPaymentReceivedHtml).not.toHaveBeenCalled()
    // Suppressing the mail must not suppress the money.
    expect(res.status ?? 200).not.toBe(500)
    expect(res.json()).toMatchObject({ ok: true, action: 'payment_recorded', receiptSent: false })
    expect(d.rows('booking_payments')).toHaveLength(1)
    // Rule 10: the log has to say we CHOSE not to tell her, so it never reads
    // like a mail that failed.
    expect(d.rows('booking_modifications')[0].change_summary).toContain('No receipt sent')
  })

  it('sends the receipt for every value that is not exactly false', async () => {
    // An opt-out, never a default. A missing or malformed flag must leave the
    // customer informed — the failure direction that cannot lose money.
    for (const value of [undefined, true, 'false', 0, null]) {
      jest.clearAllMocks()
      body = { action: 'record_payment', amount_cents: 16300, payment_method: 'venmo', send_receipt: value }
      const d = db()
      mockGetSupabase.mockReturnValue(d.client)
      await POST(req(), { params })
      expect(mockResendSend).toHaveBeenCalledTimes(1)
    }
  })
})
