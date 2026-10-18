/**
 * The owner's one-email-per-Stripe-payment note (2026-10-18).
 *
 * The case it exists for: Courtney Breitenbach paid her $1,538.82 final invoice
 * from the portal; the webhook recorded it and emailed HER, and told nobody at
 * Host Hampton.
 */

const mockSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}))

import { buildPaymentNotice, bookingRefFromMetadata, sendStripePaymentNotice, type PaymentNoticeInput } from '@/lib/stripePaymentNotice'
import { newLedgerCapture, runWithLedgerCapture, noteStripeLedgerWrite } from '@/lib/ledgerCapture'

const COURTNEY: PaymentNoticeInput = {
  eventType: 'payment_intent.succeeded',
  eventId: 'evt_1',
  livemode: true,
  created: Date.UTC(2026, 9, 18, 0, 53, 46) / 1000,
  writes: [{
    description: 'Party Final Payment — HH-PTY-D6N57',
    amountCents: 153882,
    category: 'Party Booking',
    customerName: 'Courtney Breitenbach ',
    reference: 'stripe-pb-HH-PTY-D6N57-final-pi_3URiL302uXWznKaW0FDtgxC5',
    notes: 'cocobreitenbach@gmail.com',
  }],
  paymentIntentId: 'pi_3URiL302uXWznKaW0FDtgxC5',
  sessionId: null,
  paymentLinkId: null,
  grossCents: 153882,
  customerName: null,
  customerEmail: 'cocobreitenbach@gmail.com',
  customerPhone: null,
  method: 'Visa •••• 4242 (apple pay)',
  stripeFeeCents: 4493,
  netCents: 149389,
  receiptUrl: 'https://pay.stripe.com/receipts/abc',
  metadata: { type: 'party_builder', booking_ref: 'HH-PTY-D6N57', payment_type: 'final', amountCents: '149400', cardFeeCents: '4482' },
  booking: {
    booking_ref: 'HH-PTY-D6N57', contact_name: 'Courtney Breitenbach ', contact_email: 'cocobreitenbach@gmail.com',
    contact_phone: '6317663848', party_date: '2026-10-18', party_time: '16:00', package_type: 'Glow Party',
    party_type: 'in_studio_theme', status: 'paid_in_full', total_cents: 179400, balance_due_cents: 0,
  },
}

describe('buildPaymentNotice', () => {
  it('names the amount, the reason and the customer in the subject', () => {
    const { subject } = buildPaymentNotice(COURTNEY)
    expect(subject).toBe('Stripe payment $1,538.82 — Party Final Payment — HH-PTY-D6N57 — Courtney Breitenbach')
  })

  it('carries source, amounts, fees, booking state and the Stripe link', () => {
    const { html } = buildPaymentNotice(COURTNEY)
    expect(html).toContain('Party planner / customer portal')
    expect(html).toContain('$1,494.00')          // credited to the booking
    expect(html).toContain('$44.82')             // card fee charged
    expect(html).toContain('$44.93')             // Stripe's fee
    expect(html).toContain('$1,493.89')          // net
    expect(html).toContain('$1,794.00')          // booking total
    expect(html).toContain('paid_in_full')
    expect(html).toContain('Sunday, October 18, 2026 at 16:00')
    expect(html).toContain('href="https://dashboard.stripe.com/payments/pi_3URiL302uXWznKaW0FDtgxC5"')
    expect(html).toContain('Sat, Oct 17, 2026, 8:53 PM ET')
  })

  it('escapes everything a customer typed', () => {
    const evil = { ...COURTNEY, booking: null, customerName: '<img src=x onerror=alert(1)>', metadata: { note: '<script>x</script>' } }
    const { html } = buildPaymentNotice(evil)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('refuses a non-https receipt link rather than rendering it', () => {
    const { html } = buildPaymentNotice({ ...COURTNEY, receiptUrl: 'javascript:alert(1)' })
    expect(html).not.toContain('javascript:')
  })

  it('marks test mode and a Payment Link with no metadata', () => {
    const { subject, html } = buildPaymentNotice({
      ...COURTNEY, livemode: false, metadata: {}, booking: null, paymentLinkId: 'plink_1', paymentIntentId: null, sessionId: 'cs_test_1',
    })
    expect(subject).toMatch(/\[TEST MODE\]$/)
    expect(html).toContain('Stripe Payment Link')
    expect(html).toContain('dashboard.stripe.com/test/checkout/sessions/cs_test_1')
  })
})

describe('bookingRefFromMetadata', () => {
  it('reads every key our code writes, and nothing that is not a ref', () => {
    expect(bookingRefFromMetadata({ booking_ref: 'HH-PTY-D6N57' })).toBe('HH-PTY-D6N57')
    expect(bookingRefFromMetadata({ bookingRef: 'HH-2026-7984' })).toBe('HH-2026-7984')
    expect(bookingRefFromMetadata({ booking_ref: 'x,or(id.neq.0)' })).toBeNull()
    expect(bookingRefFromMetadata({})).toBeNull()
  })
})

describe('ledgerCapture', () => {
  const w = COURTNEY.writes[0]

  it('is a no-op outside a capture', () => {
    expect(() => noteStripeLedgerWrite(w)).not.toThrow()
  })

  it('keeps concurrent deliveries apart', async () => {
    const a = newLedgerCapture()
    const b = newLedgerCapture()
    await Promise.all([
      runWithLedgerCapture(a, async () => { await new Promise(r => setTimeout(r, 5)); noteStripeLedgerWrite(w) }),
      runWithLedgerCapture(b, async () => { noteStripeLedgerWrite({ ...w, reference: 'other' }); noteStripeLedgerWrite(w) }),
    ])
    expect(a.writes.length).toBe(1)
    expect(b.writes.length).toBe(2)
  })
})

describe('sendStripePaymentNotice', () => {
  const OLD = process.env
  beforeEach(() => {
    process.env = { ...OLD, RESEND_API_KEY: 're_test', OWNER_NOTIFY_EMAIL: 'hosthampton295@gmail.com' }
    mockSend.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null })
  })
  afterAll(() => { process.env = OLD })

  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: COURTNEY.booking, error: null }) }) }) }),
  } as any
  const event = {
    id: 'evt_1', type: 'payment_intent.succeeded', livemode: true, created: COURTNEY.created,
    data: { object: { object: 'payment_intent', id: COURTNEY.paymentIntentId, amount: 153882, amount_received: 153882, metadata: COURTNEY.metadata } },
  } as any

  it('emails the owner, never the customer, even when Stripe cannot be read', async () => {
    const stripe = { paymentIntents: { retrieve: jest.fn().mockRejectedValue(new Error('stripe down')) } } as any
    const sent = await sendStripePaymentNotice({ event, writes: COURTNEY.writes, stripe, supabase })
    expect(sent).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0].to).toBe('hosthampton295@gmail.com')
    expect(mockSend.mock.calls[0][0].subject).toContain('$1,538.82')
  })

  it('sends nothing for a refund row and never throws when Resend does', async () => {
    const stripe = { paymentIntents: { retrieve: jest.fn() } } as any
    expect(await sendStripePaymentNotice({ event, writes: [{ ...COURTNEY.writes[0], amountCents: -500 }], stripe, supabase })).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()

    mockSend.mockRejectedValue(new Error('resend down'))
    await expect(sendStripePaymentNotice({ event, writes: COURTNEY.writes, stripe, supabase })).resolves.toBe(false)
  })
})
