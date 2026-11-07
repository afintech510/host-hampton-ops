/**
 * The mobile-party and studio-rental builders in the Manager assistant.
 *
 * What they pin: the model supplies WORDS and never a price; every figure on the
 * card comes from the live catalog and the studio rate card; a name that matches
 * nothing (or several) is refused rather than approximated; a mobile party cannot
 * be drawn without an address; each builder has its own card kind; and Confirm
 * replays the dashboard's create route with the rental facts allow-listed.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'

const mockCreate = jest.fn()
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: (...a: unknown[]) => mockCreate(...a) }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({
  POST: async () => new Response(JSON.stringify({ ok: false }), { status: 500 }),
  PATCH: jest.fn(),
}))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/sequences/enroll/route', () => ({ POST: jest.fn() }))

const mockTravel = jest.fn()
jest.mock('@/lib/mileage', () => ({ travelFeeForAddress: (...a: unknown[]) => mockTravel(...a) }))

import type { PricingItem } from '@/components/QuoteBuilder/types'
import { FALLBACK_CATALOG } from '@/lib/pricingCatalog'
import { buildQuoteItems } from '@/lib/quoteEngine'
import { billedTotalCents, type BilledItem } from '@/lib/planBalance'
import { mobileBaseCentsFor } from '@/lib/pricingCatalog'
import { studioRentalRateWith } from '@/lib/studioRental'

const item = (id: string, name: string, category: string, price_cents: number, price_type: PricingItem['price_type'] = 'flat'): PricingItem => ({
  id, name, description: null, category, price_cents, price_label: null, price_type, is_popular: false, sort_order: 0, emoji: null,
})
const groups = {
  themes: [], premiumActivities: [item('a1', 'Make Your Own Slime', 'activity-premium', 0)],
  standardActivities: [item('a2', 'Glitter Tattoos', 'activity-standard', 0), item('a3', 'Hair Braiding Bar', 'activity-standard', 0), item('a4', 'Hair Glam Bar', 'activity-standard', 0)],
  food: [], desserts: [item('d1', 'Cupcake Tower', 'dessert-add-on', 6000), item('d2', 'Cookie Platter', 'dessert-add-on', 4000)],
  beverages: [], decor: [], entertainment: [item('e1', 'Face Painter', 'entertainment-add-on', 15000)], partyAddOns: [item('x1', 'Balloon Arch', 'party-add-on', 9000)],
}
jest.mock('@/lib/quoteRequest', () => ({
  ...jest.requireActual('@/lib/quoteRequest'),
  loadQuoteCatalog: async () => ({ kind: 'ok', data: { cat: FALLBACK_CATALOG, groups, items: buildQuoteItems(groups) } }),
}))
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadPricingCatalog: async () => jest.requireActual('@/lib/pricingCatalog').FALLBACK_CATALOG,
}))

const STUDIO_MENU = [item('s1', 'Balloon Garland', 'decor-add-on', 12000), item('s2', 'Pizza Platter', 'food-add-on', 3000, 'per_person'), item('s3', 'Pizza Party Tray', 'food-add-on', 8000)]
let sameDay: Array<Record<string, unknown>> = []
let sameDayError = false
const fakeDb = {
  from: (t: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order', 'contains']) q[m] = () => q
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(
        t === 'pricing_items' ? { data: STUDIO_MENU, error: null } : sameDayError ? { data: null, error: { message: 'down' } } : { data: sameDay, error: null },
      ).then(res)
    return q
  },
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => fakeDb }))

import { runAssistantTool, ASSISTANT_TOOLS } from '@/lib/assistant/tools'
import { executeProposal } from '@/lib/assistant/execute'
import { dollars } from '@/lib/assistant/dollars'

const NOW = new Date('2026-11-07T17:00:00Z')
const ctx = { actor: 'admin:test@example.com', now: NOW }

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'builders-secret'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'builders-portal'
})
beforeEach(() => {
  mockCreate.mockReset()
  mockTravel.mockReset().mockResolvedValue({ kind: 'ok', feeCents: 7500, resolvedAddress: '12 Example Lane, Sampletown, NY' })
  sameDay = []
  sameDayError = false
})

const mobileBase = {
  contact_name: 'Sample Client', contact_email: 'sample.party@example.com', contact_phone: '6315550100', child_name: 'Sample Child',
  party_date: '2026-12-12', party_time: '14:00', guest_count: 12, address: '12 Example Lane, Sampletown, NY',
  activities: ['slime', 'glitter tattoos'],
}
const rentalBase = {
  contact_name: 'Sample Client', contact_email: 'sample.party@example.com', event_label: 'Baby shower',
  party_date: '2026-12-12', start_time: '12:00', end_time: '16:00', guest_count: 40,
}

type Out = Awaited<ReturnType<typeof runAssistantTool>>
const detail = (o: Out, label: string) => o.proposal?.proposal.details.find(d => d.startsWith(`${label}: `))?.slice(label.length + 2)
const bodyOf = (o: Out) => o.proposal!.proposal.input as Record<string, unknown>

describe('propose_create_mobile_party', () => {
  it('prices from the catalog + the address and gives a card of its own kind', async () => {
    const out = await runAssistantTool('propose_create_mobile_party', mobileBase, ctx)
    expect(out.isError).toBeUndefined()
    expect(out.proposal?.proposal.kind).toBe('create_mobile_party')
    const body = bodyOf(out)
    expect(body).toMatchObject({ partyType: 'mobile_party', locationAddress: mobileBase.address, sendEmail: false, source: 'admin', guestCount: 12 })
    const lines = body.lineItems as Array<{ name: string; category: string; unit_price_cents: number }>
    const pkg = lines.find(l => l.category === 'mobile-package')!
    expect(pkg.unit_price_cents).toBe(mobileBaseCentsFor(FALLBACK_CATALOG.mobileBands, 12) + 7500)
    expect(lines.filter(l => l.category === 'activity-add-on').map(l => l.name).sort()).toEqual(['Glitter Tattoos', 'Make Your Own Slime'])
    const total = billedTotalCents(lines as unknown as BilledItem[], 12)
    expect(detail(out, 'Total')).toBe(dollars(total))
    expect(detail(out, 'Where')).toContain('Sampletown')
    expect(detail(out, 'Travel')).toContain(dollars(7500))
    expect(detail(out, 'Activities')).toMatch(/Glitter Tattoos/)
  })

  it('adds add-ons and desserts as priced lines from the catalog', async () => {
    const out = await runAssistantTool('propose_create_mobile_party', { ...mobileBase, add_ons: ['face painter'], desserts: ['cupcake tower'] }, ctx)
    const lines = bodyOf(out).lineItems as Array<{ name: string; category: string; unit_price_cents: number }>
    expect(lines.find(l => l.name === 'Face Painter')?.unit_price_cents).toBe(15000)
    expect(lines.find(l => l.name === 'Cupcake Tower')).toMatchObject({ category: 'dessert-add-on', unit_price_cents: 6000 })
    expect(detail(out, 'Desserts')).toContain('Cupcake Tower')
    expect(detail(out, 'Add-ons')).toContain('Face Painter')
  })

  it('takes no price from the model', async () => {
    const out = await runAssistantTool(
      'propose_create_mobile_party',
      { ...mobileBase, line_items: [{ name: 'Free everything', unit_price_cents: 1 }], unit_price_cents: 1, total_cents: 1 },
      ctx,
    )
    const lines = bodyOf(out).lineItems as Array<{ name: string }>
    expect(lines.some(l => l.name === 'Free everything')).toBe(false)
    expect(JSON.stringify(bodyOf(out))).not.toContain('"total_cents"')
  })

  it('refuses a party with no address, and a vague one', async () => {
    for (const address of [undefined, '', 'home']) {
      const out = await runAssistantTool('propose_create_mobile_party', { ...mobileBase, address }, ctx)
      expect(out.isError).toBe(true)
      expect(out.proposal).toBeUndefined()
    }
  })

  it('refuses a name that matches nothing or several, naming it, and draws no card', async () => {
    const none = await runAssistantTool('propose_create_mobile_party', { ...mobileBase, activities: ['ponies'] }, ctx)
    expect(none.isError).toBe(true)
    expect(JSON.stringify(none.result)).toContain('ponies')
    const many = await runAssistantTool('propose_create_mobile_party', { ...mobileBase, activities: ['hair'] }, ctx)
    expect(many.isError).toBe(true)
    expect(JSON.stringify(many.result)).toMatch(/Hair Braiding Bar.*Hair Glam Bar|Hair Glam Bar.*Hair Braiding Bar/)
    expect(many.proposal).toBeUndefined()
  })

  it('says so when the address cannot be located instead of quietly leaving travel out', async () => {
    mockTravel.mockResolvedValue({ kind: 'not_found' })
    const out = await runAssistantTool('propose_create_mobile_party', mobileBase, ctx)
    expect(detail(out, 'Travel')).toMatch(/NOT included/)
    mockTravel.mockRejectedValue(new Error('network'))
    const out2 = await runAssistantTool('propose_create_mobile_party', mobileBase, ctx)
    expect(detail(out2, 'Travel')).toMatch(/NOT included/)
  })

  it('refuses a past date, a bad time, a missing email and too many guests', async () => {
    for (const patch of [{ party_date: '2026-11-01' }, { party_date: '2026-13-40' }, { party_time: '2pm' }, { contact_email: 'nope' }, { guest_count: 0 }, { guest_count: 500 }]) {
      const out = await runAssistantTool('propose_create_mobile_party', { ...mobileBase, ...patch }, ctx)
      expect(out.isError).toBe(true)
    }
  })

  it('shows what else is already on the date, and says when it could not check', async () => {
    sameDay = [{ booking_ref: 'HH-PTY-AAA11', party_type: 'in_studio_theme', party_time: '13:00' }]
    expect(detail(await runAssistantTool('propose_create_mobile_party', mobileBase, ctx), 'Same day')).toMatch(/1 other booking.*HH-PTY-AAA11 1:00 PM/)
    sameDayError = true
    expect(detail(await runAssistantTool('propose_create_mobile_party', mobileBase, ctx), 'Same day')).toMatch(/could not check/)
  })
})

describe('propose_create_studio_rental', () => {
  it('prices the window from the studio rate card and shows deposit and security hold', async () => {
    const out = await runAssistantTool('propose_create_studio_rental', rentalBase, ctx)
    expect(out.isError).toBeUndefined()
    expect(out.proposal?.proposal.kind).toBe('create_studio_rental')
    const rate = studioRentalRateWith(FALLBACK_CATALOG.studioRates, '2026-12-12', 4)
    const body = bodyOf(out)
    expect(body).toMatchObject({ partyType: 'studio_rental', eventType: 'studio-rental', partyTime: '12:00', sendEmail: false })
    const lines = body.lineItems as Array<{ category: string; unit_price_cents: number; name: string }>
    expect(lines[0]).toMatchObject({ category: 'rental', unit_price_cents: rate.rentalCents, name: rate.lineItemLabel })
    expect(detail(out, 'Total')).toBe(dollars(rate.rentalCents))
    expect(detail(out, 'Security hold')).toContain(dollars(FALLBACK_CATALOG.studioRates.securityDepositCents))
    expect(detail(out, 'Window')).toMatch(/weekend/)
    expect(body.partyTagsExtra).toMatchObject({
      rental_start_time: '12:00', rental_end_time: '16:00', rental_hours: 4, is_weekend: true, event_label: 'Baby shower',
      security_deposit_cents: FALLBACK_CATALOG.studioRates.securityDepositCents, balance_due_date: '2026-12-05',
    })
  })

  it('bills the minimum when the window is shorter, and says so', async () => {
    const out = await runAssistantTool('propose_create_studio_rental', { ...rentalBase, end_time: '13:00' }, ctx)
    const rate = studioRentalRateWith(FALLBACK_CATALOG.studioRates, '2026-12-12', 1)
    expect(rate.hours).toBe(FALLBACK_CATALOG.studioRates.minHours)
    expect(detail(out, 'Window')).toContain(`${rate.hours} hrs`)
    expect(detail(out, 'Window')).toMatch(/minimum/)
  })

  it('uses the weekday rate on a weekday', async () => {
    const out = await runAssistantTool('propose_create_studio_rental', { ...rentalBase, party_date: '2026-12-10' }, ctx)
    expect(detail(out, 'Window')).toMatch(/weekday/)
    expect((bodyOf(out).partyTagsExtra as Record<string, unknown>).is_weekend).toBe(false)
  })

  it('adds studio-menu add-ons by name, with quantity and the per-guest rule', async () => {
    const out = await runAssistantTool('propose_create_studio_rental', { ...rentalBase, add_ons: [{ name: 'balloon garland', quantity: 2 }, { name: 'pizza platter' }] }, ctx)
    const lines = bodyOf(out).lineItems as Array<{ name: string; quantity: number; guest_multiplied: boolean; unit_price_cents: number }>
    expect(lines.find(l => l.name === 'Balloon Garland')).toMatchObject({ quantity: 2, unit_price_cents: 12000, guest_multiplied: false })
    expect(lines.find(l => l.name === 'Pizza Platter')).toMatchObject({ guest_multiplied: true, unit_price_cents: 3000 })
    const total = billedTotalCents(lines as unknown as BilledItem[], 40)
    expect(detail(out, 'Total')).toBe(dollars(total))
  })

  it('refuses unknown and ambiguous add-ons, over-capacity, a backwards window and a missing event', async () => {
    for (const patch of [
      { add_ons: ['dj booth'] }, { add_ons: ['pizza'] }, { guest_count: 120 }, { end_time: '11:00' }, { end_time: '12:00' },
      { event_label: '' }, { start_time: '9am' }, { add_ons: [{ name: 'balloon garland', quantity: 500 }] },
    ]) {
      const out = await runAssistantTool('propose_create_studio_rental', { ...rentalBase, ...patch }, ctx)
      expect(out.isError).toBe(true)
      expect(out.proposal).toBeUndefined()
    }
  })
})

describe('the two builders are separate cards that Confirm replays through the create route', () => {
  const req = () => new NextRequest('http://localhost/api/admin/assistant/confirm', { method: 'POST', headers: { authorization: 'Bearer x' } })

  it.each([
    ['propose_create_mobile_party', mobileBase, 'create_mobile_party'],
    ['propose_create_studio_rental', rentalBase, 'create_studio_rental'],
  ])('%s → executeProposal posts the bound body', async (tool, input, kind) => {
    const out = await runAssistantTool(tool, input as Record<string, unknown>, ctx)
    expect(out.proposal?.proposal.kind).toBe(kind)
    mockCreate.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true, bookingRef: 'HH-PTY-NEW01', bookingId: 'b1', adminUrl: 'https://www.hosthampton.com/admin' }), { status: 200 }),
    )
    const result = await executeProposal(req(), out.proposal!.proposal)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('HH-PTY-NEW01')
    const sent = await (mockCreate.mock.calls[0][0] as NextRequest).json()
    expect(sent).toEqual(bodyOf(out))
  })

  it('the tool list names both, each as a PROPOSE tool', () => {
    for (const n of ['propose_create_mobile_party', 'propose_create_studio_rental']) {
      expect(ASSISTANT_TOOLS.find(t => t.name === n)?.description).toMatch(/^PROPOSE /)
    }
  })
})

describe('the create route keeps only the rental facts it knows', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../app/api/admin/parties/create/route.ts'), 'utf8')

  it('allow-lists the tag keys and the value types', () => {
    const block = src.slice(src.indexOf('const STUDIO_RENTAL_TAGS'), src.indexOf('export async function POST'))
    for (const k of ['rental_start_time', 'rental_end_time', 'rental_hours', 'is_weekend', 'event_label', 'address', 'seating_needed', 'balance_due_date', 'security_deposit_cents']) {
      expect(block).toContain(`'${k}'`)
    }
    expect(block).toMatch(/typeof v === 'string'/)
    expect(block).toMatch(/typeof v === 'number' && Number\.isFinite\(v\)/)
    expect(block).not.toMatch(/\.\.\.\(raw/)
    expect(src).toContain('...screenRentalTags(partyTagsExtra)')
  })

  it('the planner and the assistant share one travel-fee implementation', () => {
    const route = fs.readFileSync(path.resolve(__dirname, '../../app/api/party-builder/mileage/route.ts'), 'utf8')
    expect(route).toContain("from '@/lib/mileage'")
    expect(route).not.toMatch(/PER_MILE_CENTS|FREE_RADIUS_MILES/)
    const lib = fs.readFileSync(path.resolve(__dirname, '../../lib/mileage.ts'), 'utf8')
    expect(lib).toMatch(/FREE_RADIUS_MILES = 20/)
    expect(lib).toMatch(/PER_MILE_CENTS = 500/)
  })
})
