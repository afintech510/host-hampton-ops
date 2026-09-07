/**
 * Tests for the public check-in API.
 * Covers: token gating (no data leaks pre-validation), marketing consent going
 * through upsertContact, and completion suppressing the scheduled texts.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

const mockResolve = jest.fn()
jest.mock('@/lib/checkinLink', () => ({ resolveCheckinToken: (t: string) => mockResolve(t) }))

const mockUpsertContact = jest.fn()
jest.mock('@/lib/contacts', () => ({ upsertContact: (a: any) => mockUpsertContact(a) }))

const mockCancel = jest.fn()
jest.mock('@/lib/checkinReminders', () => ({ cancelCheckinReminders: (r: string) => mockCancel(r) }))

import { GET, POST } from '@/app/api/checkin/[token]/route'

const BOOKING = {
  id: 'b-1',
  booking_ref: 'HH-2026-0042',
  party_date: '2026-10-11',
  party_time: '2:00 PM',
  package_type: 'Glow Party',
  child_name: 'Ava',
  event_type: 'kid-party',
  checkin_status: 'pending',
  contact_name: 'Jane Doe',
  contact_email: 'jane@example.com',
  contact_phone: '5551234567',
  // Fields that must NEVER be exposed on a public route:
  admin_notes: 'customer haggled hard',
  total_cents: 125000,
  balance_due_cents: 100000,
  stripe_payment_intent_id: 'pi_secret',
}

function makeSupabase(opts: { existingContact?: any } = {}) {
  const updates: { table: string; payload: any }[] = []
  const inserts: { table: string; payload: any }[] = []

  function chain(table: string): any {
    const c: any = {}
    ;['select', 'limit'].forEach(m => (c[m] = jest.fn(() => c)))
    c.eq = jest.fn(() => c)
    c.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: table === 'contacts' ? (opts.existingContact ?? null) : null, error: null }),
    )
    c.single = jest.fn(() => Promise.resolve({ data: null, error: null }))
    c.insert = jest.fn((payload: any) => {
      inserts.push({ table, payload })
      return Promise.resolve({ error: null })
    })
    c.update = jest.fn((payload: any) => {
      updates.push({ table, payload })
      const u: any = {}
      u.eq = jest.fn(() => u)
      const p = Promise.resolve({ error: null })
      u.then = p.then.bind(p)
      u.catch = p.catch.bind(p)
      return u
    })
    return c
  }

  return { supabase: { from: jest.fn((t: string) => chain(t)) } as any, updates, inserts }
}

const params = Promise.resolve({ token: 'tok' })
const makeReq = (body: any) => ({ json: async () => body }) as any

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsertContact.mockResolvedValue('c-1')
})

describe('GET /api/checkin/[token]', () => {
  it('404s an unknown token and returns no booking data', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res: any = await GET({} as any, { params })
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('HH-2026-0042')
  })

  it('410s an expired link', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'expired' })
    const res: any = await GET({} as any, { params })
    expect(res.status).toBe(410)
  })

  it('returns only public booking fields for a valid token', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    const res: any = await GET({} as any, { params })
    expect(res.status).toBe(200)

    expect(res.body.bookingRef).toBe('HH-2026-0042')
    expect(res.body.contact.name).toBe('Jane Doe')

    // Internal/commercial fields must not leak onto a public, tokenised page.
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('customer haggled hard')
    expect(serialized).not.toContain('pi_secret')
    expect(serialized).not.toContain('125000')
  })
})

describe('POST /api/checkin/[token]', () => {
  it('rejects an invalid token without writing anything', async () => {
    mockResolve.mockResolvedValue({ ok: false, reason: 'invalid' })
    const { supabase, updates } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    const res: any = await POST(makeReq({ name: 'X', email: 'x@y.com' }), { params })
    expect(res.status).toBe(404)
    expect(updates).toHaveLength(0)
    expect(mockUpsertContact).not.toHaveBeenCalled()
  })

  it('requires a name and a valid email', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    mockGetSupabase.mockReturnValue(makeSupabase().supabase)

    expect((await POST(makeReq({ name: '', email: 'a@b.com' }), { params }) as any).status).toBe(400)
    expect((await POST(makeReq({ name: 'A', email: 'nope' }), { params }) as any).status).toBe(400)
  })

  it('saves details and moves the status to started', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    const { supabase, updates } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    const res: any = await POST(makeReq({
      name: 'Jane Doe', email: 'Jane@Example.com ', phone: '5551234567',
      addressLine1: '1 Main St', city: 'Speonk', state: 'NY', postalCode: '11972',
      marketingConsent: true,
    }), { params })

    expect(res.status).toBe(200)
    const bookingUpdate = updates.find(u => u.table === 'bookings')!
    expect(bookingUpdate.payload).toMatchObject({
      contact_name: 'Jane Doe',
      contact_email: 'jane@example.com', // normalized
      checkin_address_line1: '1 Main St',
      checkin_city: 'Speonk',
      checkin_status: 'started',
    })
  })

  it('records the marketing opt-in through upsertContact, not a booking column', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    const { supabase, updates } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    await POST(makeReq({
      name: 'Jane Doe', email: 'jane@example.com', phone: '5551234567', marketingConsent: true,
    }), { params })

    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'jane@example.com',
      marketingConsent: true,
      sourceDetail: 'Check-in — HH-2026-0042',
    }))

    // The consent must NOT be mirrored onto the booking as a loose boolean.
    const bookingUpdate = updates.find(u => u.table === 'bookings')!
    expect(JSON.stringify(bookingUpdate.payload)).not.toMatch(/marketing/i)
  })

  it('passes marketingConsent false when the box is unticked', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    mockGetSupabase.mockReturnValue(makeSupabase().supabase)

    await POST(makeReq({ name: 'Jane Doe', email: 'jane@example.com' }), { params })

    expect(mockUpsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ marketingConsent: false }),
    )
  })

  it('does not demote an existing customer back to a lead', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    const { supabase, updates } = makeSupabase({
      existingContact: { id: 'c-1', status: 'customer', source: 'referral' },
    })
    mockGetSupabase.mockReturnValue(supabase)

    await POST(makeReq({ name: 'Jane Doe', email: 'jane@example.com', marketingConsent: true }), { params })

    // upsertContact resets status→lead / source→direct; we must put them back.
    const restore = updates.find(u => u.table === 'contacts')
    expect(restore?.payload).toEqual({ status: 'customer', source: 'referral' })
  })

  it('completes the check-in and suppresses both texts when already signed', async () => {
    mockResolve.mockResolvedValue({
      ok: true,
      booking: { ...BOOKING, checkin_agreement_signed_at: '2026-10-01T00:00:00Z' },
    })
    const { supabase, updates } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    await POST(makeReq({ name: 'Jane Doe', email: 'jane@example.com' }), { params })

    const completion = updates.find(u => u.table === 'bookings' && u.payload.checkin_status === 'complete')
    expect(completion).toBeTruthy()
    expect(mockCancel).toHaveBeenCalledWith('HH-2026-0042')
  })

  it('does not suppress the texts when the agreement is still unsigned', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    mockGetSupabase.mockReturnValue(makeSupabase().supabase)

    await POST(makeReq({ name: 'Jane Doe', email: 'jane@example.com' }), { params })
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('still saves details when consent recording fails', async () => {
    mockResolve.mockResolvedValue({ ok: true, booking: BOOKING })
    const { supabase, updates } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)
    mockUpsertContact.mockResolvedValue(null)

    const res: any = await POST(makeReq({ name: 'Jane Doe', email: 'jane@example.com' }), { params })

    expect(res.status).toBe(200)
    expect(updates.find(u => u.table === 'bookings')).toBeTruthy()
  })
})
