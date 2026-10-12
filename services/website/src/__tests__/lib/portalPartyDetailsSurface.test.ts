/**
 * `/my-booking`'s party details — the privacy and invoice-number rules, held.
 *
 * The 2026-10-11 rework lists every detail of a customer's party. Three things
 * could go wrong doing that, and each has a rule here:
 *
 *   S1  The food choices live in `quote_snapshot`, which must never reach a
 *       customer whole (portalAuthSurface names it). They are read as aliased
 *       `->>` scalars in lib/portalPartyDetails.ts, and nowhere else.
 *   S2  `bookings.notes` is admin scratch ("NOTHING SENT TO THE CUSTOMER",
 *       "confirm before chasing"). It is off the portal allow-list, and the raw
 *       `party_tags` / planner aliases are stripped before the row is returned.
 *   S3  Opening `/plan/<ref>/summary` ISSUES an invoice number. The page links
 *       to it with a plain anchor — never fetches, embeds or prefetches it — and
 *       only once there is a quote to show.
 *
 * Conventions (AGENTS.md §11): comments stripped before any rule runs, CRLF-
 * tolerant anchors, every rule counts what it examined, no skipped rules.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))
jest.mock('@/lib/portalAuth', () => ({
  ...jest.requireActual('@/lib/portalAuth'),
  getPortalBookingRef: () => 'HH-PTY-TEST1',
  portalSigningSecret: () => 'test-secret',
}))

import { readSrc } from '../helpers/sourceScan'
import { GET } from '@/app/api/portal/booking/route'
import { PORTAL_INTERNAL_ROW_KEYS } from '@/lib/portalPartyDetails'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const LIB = readSrc('lib', 'portalPartyDetails.ts')
const ROUTE = readSrc('app', 'api', 'portal', 'booking', 'route.ts')
const PAGE = readSrc('app', 'my-booking', 'MyBookingContent.tsx')

describe('S0 · the files this surface is about are really being read', () => {
  it.each([
    ['lib', LIB],
    ['route', ROUTE],
    ['page', PAGE],
  ])('%s is non-trivial after comment stripping', (_n, src) => {
    expect(src.replace(/\s+/g, '').length).toBeGreaterThan(2000)
  })
})

describe('S1 · the snapshot is read key by key, never whole', () => {
  it('every quote_snapshot in the details module is a `->>` scalar read', () => {
    const all = LIB.match(/quote_snapshot/g) ?? []
    const scalar = LIB.match(/quote_snapshot->>/g) ?? []
    expect(all.length).toBeGreaterThan(0)
    expect(scalar.length).toBe(all.length)
  })

  it('the route never names the snapshot, and appends the scalar list to its allow-list', () => {
    expect(ROUTE).not.toMatch(/quote_snapshot/)
    expect(ROUTE).toMatch(/PORTAL_BOOKING_FIELDS\.join\(', '\)\s*\+\s*', '\s*\+\s*PORTAL_SELECTION_COLUMNS/)
  })

  it('no client file under /my-booking mentions the snapshot or the raw tags', () => {
    const files = ['MyBookingContent.tsx', 'PortalCardPayment.tsx', 'pay/page.tsx'].map(f => readSrc('app', 'my-booking', ...f.split('/')))
    expect(files).toHaveLength(3)
    for (const src of files) expect(src).not.toMatch(/quote_snapshot|party_tags/)
  })
})

describe('S2 · admin scratch and raw tags stay on the server', () => {
  it("`notes` is not in the portal's column allow-list", () => {
    const list = /const PORTAL_BOOKING_FIELDS: readonly string\[\] = \[([\s\S]*?)\]/.exec(ROUTE)
    expect(list).not.toBeNull()
    const cols = (list![1].match(/'([a-z0-9_]+)'/g) ?? []).map(s => s.slice(1, -1))
    expect(cols.length).toBeGreaterThan(30)
    expect(cols).not.toContain('notes')
    expect(cols).not.toContain('admin_notes')
  })

  it('the GET returns a PICK of allow-listed fields minus the internal keys, never the raw row', () => {
    expect(ROUTE).toMatch(
      /PORTAL_RESPONSE_FIELDS = PORTAL_BOOKING_FIELDS\.filter\(k => !PORTAL_INTERNAL_ROW_KEYS\.includes\(k\)\)/,
    )
    const get = ROUTE.slice(ROUTE.indexOf('export async function GET'), ROUTE.indexOf('export async function PATCH'))
    expect(get.length).toBeGreaterThan(500)
    const pick = get.search(/for \(const k of PORTAL_RESPONSE_FIELDS\) if \(k in booking\) publicRow\[k\] = booking\[k\]/)
    const spread = get.search(/\.\.\.publicRow/)
    expect(pick).toBeGreaterThan(-1)
    expect(spread).toBeGreaterThan(pick)
    expect(get).not.toMatch(/\.\.\.booking\b/)
  })

  it('the page never renders booking.notes', () => {
    expect(PAGE).not.toMatch(/booking\.notes/)
  })
})

describe('S2 · driven: what the GET actually returns', () => {
  const ROW = {
    id: 'bk-1',
    booking_ref: 'HH-PTY-TEST1',
    status: 'deposit_paid',
    party_type: 'in_studio_theme',
    party_date: '2099-06-20',
    party_time: '13:00',
    guest_count_approx: 12,
    child_name: 'Ava',
    notes: 'Created by admin — NOTHING SENT TO THE CUSTOMER',
    party_tags: { custom_rate_reason: 'owner-approved', modifications_unlocked: false },
    quote_snapshot: { contactEmail: 'x@example.com', cupcakeFlavor: 'chocolate' },
    sel_cupcake_flavor: 'chocolate',
    sel_pizza_or_bagels: 'pizza',
  }

  it('carries `details`, and none of notes, party_tags, the snapshot or an alias', async () => {
    mockGetSupabase.mockReturnValue(
      makeFakeMoneyDb({
        bookings: [{ ...ROW }],
        booking_line_items: [
          { booking_id: 'bk-1', name: 'Glow Party', category: 'theme', quantity: 1, unit_price_cents: 85000, guest_multiplied: false, sort_order: 0 },
        ],
        booking_payments: [],
        booking_modifications: [],
      }).client as any,
    )
    const res: any = await GET({ headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : null) } } as any)
    expect(res.status).toBe(200)
    const b = res.body.booking
    // The fake ignores the select and echoes every stored column — including
    // `notes` and the whole snapshot — so this proves the route PICKS rather
    // than relying on what it selected.
    for (const k of [...PORTAL_INTERNAL_ROW_KEYS, 'notes', 'quote_snapshot']) expect(b).not.toHaveProperty(k)
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('NOTHING SENT')
    expect(text).not.toContain('owner-approved')
    expect(res.body.details.kind).toBe('in_studio')
    expect(res.body.details.choices).toEqual([
      { label: 'Pizza or bagels', value: 'Pizza' },
      { label: 'Cupcake flavor', value: 'Chocolate' },
    ])
    expect(res.body.details.sections[0].lines[0]).toMatchObject({ name: 'Glow Party', amountCents: 85000 })
  })
})

describe('S3 · the invoice is linked, never opened from here', () => {
  it('links /plan/<ref>/summary through a plain anchor', () => {
    expect(PAGE).toMatch(/`\/plan\/\$\{encodeURIComponent\(booking\.booking_ref\)\}\/summary`/)
    expect(PAGE).toMatch(/<a href=\{invoiceHref\}/)
  })

  it('nothing fetches, embeds or prefetches it', () => {
    expect(PAGE).not.toMatch(/fetch\(\s*[`'"]\/plan\//)
    expect(PAGE).not.toMatch(/<iframe/i)
    expect(PAGE).not.toMatch(/prefetch/)
    expect(PAGE).not.toMatch(/from 'next\/link'/)
  })

  it('is offered only once there is a quote on it (an unpriced lead would burn a number)', () => {
    expect(PAGE).toMatch(/const invoiceHref = !data\.money\?\.unpriced && hasLines\s*\?/)
  })
})
