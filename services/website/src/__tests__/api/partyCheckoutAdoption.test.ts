/**
 * `/api/party-checkout` must not FORK a plan the customer already holds.
 *
 * The defect, found 2026-09-16 while making the deposit payable on an unpriced
 * plan: this route called `generatePartyRef()` unconditionally. A customer who
 * arrived on a real Party Plan by portal link — the plan we emailed her, with
 * her date on it — built it out and pressed "Request This Party" got a SECOND
 * `pending_review` booking under a new ref. The plan she was sent was orphaned,
 * and so was any deposit conversation attached to it.
 *
 * `/api/party-builder/save` has passed `bookingRef` since it was written, with
 * the comment "Keep re-saves on the plan already open instead of forking a new
 * one". This path simply never did.
 *
 * Ownership is proved by the PORTAL COOKIE and not by a ref in the body: this
 * is an unauthenticated public route and a ref is guessable. The four rules
 * below are what the adoption is bounded by, and each has a test:
 *
 *   1. no cookie          → a new booking, exactly as before;
 *   2. cookie + same email → adopt, and do not lose `party_tags` or `notes`;
 *   3. cookie + different email → do NOT adopt (a shared browser);
 *   4. cookie + cancelled plan  → do NOT adopt.
 */

import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

let mockPortalRef: string | null = null
jest.mock('@/lib/portalAuth', () => ({
  getPortalBookingRef: () => mockPortalRef,
  portalSigningSecret: () => 'test-secret',
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

jest.mock('@/lib/contacts', () => ({ upsertContact: jest.fn().mockResolvedValue('contact-1') }))
jest.mock('@/lib/sequences', () => ({ enrollInSequence: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/agent/events', () => ({ recordInboundEvent: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/ownerNotify', () => ({
  ownerEmail: () => 'owner@example.com',
  notifyOwnerSms: jest.fn().mockResolvedValue(null),
  leadSmsLine: () => 'x',
}))
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn().mockResolvedValue({ id: 'e1' }) } })),
}))

import { POST } from '@/app/api/party-checkout/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

const EXISTING = {
  id: 'bk-existing',
  booking_ref: 'HH-PTY-OPEN1',
  status: 'awaiting_deposit',
  contact_email: 'Bonnie@Example.com',
  contact_name: 'Bonnie V',
  party_type: 'in_studio_theme',
  total_cents: 0,
  balance_due_cents: 0,
  notes: 'Instagram DM inquiry — do not lose me',
  party_tags: { date_locked: true, created_by: 'ADMIN' },
}

const LINE_ITEM = {
  name: 'Theme Package',
  category: 'theme',
  quantity: 1,
  unit_price_cents: 60_000,
  price_type: 'flat',
  guest_multiplied: false,
}

function req(email: string) {
  return {
    headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : n === 'cf-connecting-ip' ? '203.0.113.9' : null) },
    json: async () => ({
      lineItems: [LINE_ITEM],
      contactName: 'Bonnie V',
      contactEmail: email,
      contactPhone: '6315550100',
      partyDate: '2026-11-29',
      partyTime: '12:00',
      guestCount: 10,
      packageType: 'Theme Party',
    }),
  } as never
}

function seed(overrides: Record<string, unknown> = {}) {
  const db = makeFakeMoneyDb({ bookings: [{ ...EXISTING, ...overrides }] })
  mockGetSupabase.mockReturnValue(db.client)
  return db
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetRateLimitForTests()
  mockPortalRef = null
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

describe('POST /api/party-checkout — adoption', () => {
  it('with no portal cookie it creates a NEW booking, as it always did', async () => {
    const db = seed()
    mockPortalRef = null

    const res = (await POST(req('someone-else@example.com'))) as unknown as { status: number }
    expect(res.status ?? 200).toBe(200)

    const bookings = db.rows('bookings')
    expect(bookings).toHaveLength(2)
    expect(bookings.some(b => b.booking_ref === EXISTING.booking_ref && b.status === 'awaiting_deposit')).toBe(true)
  })

  it('adopts the plan the cookie names when the email matches — no second row', async () => {
    const db = seed()
    mockPortalRef = EXISTING.booking_ref

    await POST(req('bonnie@example.com')) // deliberately different CASE

    const bookings = db.rows('bookings')
    expect(bookings).toHaveLength(1)
    const b = bookings[0]
    expect(b.booking_ref).toBe(EXISTING.booking_ref)
    expect(b.status).toBe('pending_review')
    expect(b.total_cents).toBe(60_000)
  })

  it('adopting does not lose the date hold or the note already on the plan', async () => {
    // The two fields a blind `.update()` would have destroyed. `date_locked`
    // false would silently release a date the customer may have PAID to hold.
    const db = seed()
    mockPortalRef = EXISTING.booking_ref

    await POST(req('bonnie@example.com'))

    const b = db.rows('bookings')[0]
    expect((b.party_tags as Record<string, unknown>).date_locked).toBe(true)
    expect((b.party_tags as Record<string, unknown>).created_by).toBe('ADMIN')
    expect(b.notes).toBe('Instagram DM inquiry — do not lose me')
  })

  it('does NOT adopt a plan belonging to a different email', async () => {
    const db = seed()
    mockPortalRef = EXISTING.booking_ref

    await POST(req('someone-else@example.com'))

    const bookings = db.rows('bookings')
    expect(bookings).toHaveLength(2)
    // The original is untouched.
    const original = bookings.find(b => b.booking_ref === EXISTING.booking_ref)!
    expect(original.status).toBe('awaiting_deposit')
    expect(original.total_cents).toBe(0)
  })

  it('does NOT adopt a cancelled plan', async () => {
    const db = seed({ status: 'cancelled' })
    mockPortalRef = EXISTING.booking_ref

    await POST(req('bonnie@example.com'))

    const bookings = db.rows('bookings')
    expect(bookings).toHaveLength(2)
    expect(bookings.find(b => b.booking_ref === EXISTING.booking_ref)!.status).toBe('cancelled')
  })

  it('replaces the line items on an adopted plan rather than appending to them', async () => {
    // Appending would bill the customer twice for everything already chosen.
    const db = makeFakeMoneyDb({
      bookings: [EXISTING],
      booking_line_items: [
        { id: 'li-old', booking_id: EXISTING.id, name: 'Old Item', quantity: 1, unit_price_cents: 1_000, guest_multiplied: false },
      ],
    })
    mockGetSupabase.mockReturnValue(db.client)
    mockPortalRef = EXISTING.booking_ref

    await POST(req('bonnie@example.com'))

    const items = db.rows('booking_line_items').filter(i => i.booking_id === EXISTING.id)
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Theme Package')
  })
})
