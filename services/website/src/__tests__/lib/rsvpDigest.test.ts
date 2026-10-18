/**
 * The owner's daily RSVP digest (2026-10-18).
 */

const mockSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}))

const mockMint = jest.fn()
jest.mock('@/lib/portalLinkMint', () => ({
  mintPortalLink: (...a: unknown[]) => mockMint(...a),
}))

import { digestHtml, partyTotals, sendRsvpDigest, type DigestParty } from '@/lib/evites/rsvpDigest'

const NOW = new Date('2026-10-18T12:00:00Z')

const PARTY: DigestParty = {
  bookingId: 'b1',
  bookingRef: 'HH-2026-2515',
  hostName: 'Kristin Climer',
  childName: 'Brylee',
  packageType: 'Glow Party',
  partyDate: '2026-11-22',
  partyTime: '13:00',
  rsvpDeadline: '2026-11-15',
  publicUrl: 'https://www.hosthampton.com/i/brylee-birthday-p7bh',
  hostUrl: 'https://www.hosthampton.com/api/portal/auth?ref=HH-2026-2515&token=t&redirect=%2Fmy-booking%2Finvitation',
  rsvps: [
    {
      status: 'yes', parent_name: 'Jen <b>Smith</b>', children: [{ first_name: 'Ava' }, { first_name: 'Mia' }],
      adult_count: 1, has_allergy: true, allergy_note: 'peanuts <script>', created_at: '2026-10-18T02:00:00Z', updated_at: '2026-10-18T02:00:00Z',
    },
    {
      status: 'yes', parent_name: 'Dana', children: [{ first_name: 'Leo' }],
      adult_count: 2, has_allergy: false, allergy_note: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-17T20:00:00Z',
    },
    {
      status: 'no', parent_name: 'Pat', children: [], adult_count: 0, has_allergy: null, allergy_note: null,
      created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
    },
  ],
}

describe('partyTotals', () => {
  it('counts families, kids, adults, declines, allergies and the last 24 hours', () => {
    expect(partyTotals(PARTY, NOW)).toEqual({ families: 2, kids: 3, adults: 3, declined: 1, allergies: 1, recent: 2 })
  })
})

describe('digestHtml', () => {
  const { subject, html } = digestHtml([PARTY], NOW)

  it('summarises the day in the subject', () => {
    expect(subject).toBe('RSVP digest — 2 new or changed in the last day · 1 upcoming party')
  })

  it('names the party, the counts and who is new or changed', () => {
    expect(html).toContain("Brylee&#39;s Glow Party")
    expect(html).toContain('Sun, Nov 22 at 1:00 PM')
    expect(html).toContain('RSVP by Sun, Nov 15')
    expect(html).toContain('NEW')
    expect(html).toContain('CHANGED')
    expect(html).toContain('Ava, Mia')
    expect(html).toContain('Not coming')
  })

  it('links to the host RSVP page and the invitation', () => {
    expect(html).toContain('href="https://www.hosthampton.com/api/portal/auth?ref=HH-2026-2515&amp;token=t&amp;redirect=%2Fmy-booking%2Finvitation"')
    expect(html).toContain('href="https://www.hosthampton.com/i/brylee-birthday-p7bh"')
  })

  it('escapes everything a guest typed', () => {
    expect(html).not.toContain('<b>Smith</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('peanuts &lt;script&gt;')
  })

  it('renders no host link when minting failed, rather than a dead one', () => {
    const { html: h } = digestHtml([{ ...PARTY, hostUrl: null }], NOW)
    expect(h).not.toContain('Open the host')
  })
})

/** A just-enough PostgREST double: each table answers with its rows, or with an error. */
function fakeDb(tables: Record<string, { data?: unknown[]; error?: { message: string } }>) {
  return {
    from(t: string) {
      const res = tables[t] ?? { data: [] }
      const chain: any = {
        select: () => chain, not: () => chain, is: () => chain, in: () => chain, gte: () => chain,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: res.data ?? null, error: res.error ?? null }).then(ok),
      }
      return chain
    },
  } as any
}

describe('sendRsvpDigest', () => {
  const OLD = process.env
  beforeEach(() => {
    process.env = { ...OLD, RESEND_API_KEY: 're_test', OWNER_NOTIFY_EMAIL: 'hosthampton295@gmail.com' }
    mockSend.mockReset().mockResolvedValue({ data: { id: 'x' }, error: null })
    mockMint.mockReset().mockResolvedValue({ ok: true, url: PARTY.hostUrl, expiresAt: new Date() })
  })
  afterAll(() => { process.env = OLD })

  const DB = {
    evites: { data: [{ id: 'e1', booking_id: 'b1', slug: 'brylee-birthday-p7bh', rsvp_deadline: null }] },
    bookings: { data: [{ id: 'b1', booking_ref: 'HH-2026-2515', status: 'approved', party_date: '2026-11-22', party_time: '13:00', package_type: 'Glow Party', child_name: 'Brylee', contact_name: 'Kristin' }] },
    evite_rsvps: { data: PARTY.rsvps.map(r => ({ ...r, evite_id: 'e1' })) },
  }

  it('emails the owner one digest with a 48-hour host link per party', async () => {
    const out = await sendRsvpDigest(fakeDb(DB), NOW)
    expect(out).toMatchObject({ kind: 'sent', parties: 1, recent: 2, linksMinted: 1 })
    expect(mockMint).toHaveBeenCalledWith(expect.anything(), 'b1', 'HH-2026-2515', '/my-booking/invitation', { ttlHours: 48 })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0].to).toBe('hosthampton295@gmail.com')
  })

  it('a failed read is unavailable, never an empty digest', async () => {
    const out = await sendRsvpDigest(fakeDb({ ...DB, evite_rsvps: { error: { message: 'boom' } } }), NOW)
    expect(out.kind).toBe('unavailable')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips cancelled and lost parties, and sends nothing when none are left', async () => {
    const out = await sendRsvpDigest(fakeDb({ ...DB, bookings: { data: [{ ...DB.bookings.data[0], status: 'cancelled' }] } }), NOW)
    expect(out.kind).toBe('nothing')
    expect(mockSend).not.toHaveBeenCalled()
  })
})
