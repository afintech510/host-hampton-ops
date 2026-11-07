/**
 * The party card in the assistant chat (everything about one party on one card),
 * the invoice link on a created party's card, the Copy button's check mark, and
 * Sign out on the crew app's Profile line.
 */
import fs from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockInvoice = jest.fn()
jest.mock('@/lib/planInvoice', () => ({
  ...jest.requireActual('@/lib/planInvoice'),
  loadPlanInvoice: (...a: unknown[]) => mockInvoice(...a),
}))
const mockCreate = jest.fn()
const mockPost = jest.fn()
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: (...a: unknown[]) => mockCreate(...a) }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({ POST: (...a: unknown[]) => mockPost(...a), PATCH: jest.fn() }))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/sequences/enroll/route', () => ({ POST: jest.fn() }))

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}
let failItems = false
const fakeDb = {
  from: (t: string) => {
    let rows = [...(tables[t] ?? [])]
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (c: string, v: unknown) => ((rows = rows.filter(r => r[c] === v)), q)
    q.in = (c: string, vs: unknown[]) => ((rows = rows.filter(r => vs.includes(r[c]))), q)
    q.order = () => q
    q.limit = () => q
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(failItems && t === 'booking_line_items' ? { data: null, error: { message: 'down' } } : { data: rows, error: null }).then(res)
    return q
  },
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => fakeDb }))

import { loadPartyCard } from '@/lib/assistant/partyCard'
import { runAssistantTool } from '@/lib/assistant/tools'
import { executeProposal } from '@/lib/assistant/execute'
import { mintProposal } from '@/lib/assistant/proposals'
import { dollars } from '@/lib/assistant/dollars'
import PartyCardView from '@/components/admin/PartyCardView'
import { copyText } from '@/lib/copyText'

const NOW = new Date('2026-11-07T17:00:00Z')
const BOOKING = {
  id: 'bbbbbbbb-0000-4000-8000-0000000000e1', booking_ref: 'HH-PTY-CARD1', status: 'awaiting_deposit', party_type: 'in_studio_theme',
  event_type: 'birthday', package_type: null, invoice_number: null, contact_name: 'Sample Client', contact_email: 'sample.party@example.com',
  contact_phone: '+16315550100', party_date: '2026-12-24', party_time: '12:00', guest_count_approx: 12, child_name: 'Sample Child', child_age: 7,
  party_tags: null, notes: 'admin scratch', total_cents: 102000, deposit_amount: 25000, balance_due_cents: 102000, security_deposit_status: null, created_at: '2026-11-05T12:00:00Z',
}
const invoice = (over: Row = {}, booking: Row = {}) => ({
  ok: true,
  invoice: {
    booking: { ...BOOKING, ...booking }, partyType: 'in_studio_theme', lineItems: [], venueAddress: null, totalCents: 102000, paidCents: 0,
    outstandingCents: 102000, guestCount: 12, depositCents: 25000, depositOwedCents: 25000, overpaidCents: 0, ...over,
  },
})
const item = (name: string, category: string, cents: number, qty = 1, per = false): Row => ({
  booking_id: BOOKING.id, name, category, quantity: qty, unit_price_cents: cents, guest_multiplied: per, is_optional: false,
})

beforeEach(() => {
  failItems = false
  tables = {
    booking_line_items: [item('Glow Party', 'theme', 95000), item('Additional Guests', 'theme', 3500, 2)],
    booking_payments: [],
    bookings: [BOOKING],
  }
  mockInvoice.mockReset().mockResolvedValue(invoice())
  mockCreate.mockReset()
  mockPost.mockReset()
})

describe('the party card holds everything, in the order the manager reads it', () => {
  it('builds the sample card exactly', async () => {
    const r = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    const c = r.card
    expect(c.title).toBe("Sample Child's Party")
    expect(c.contact).toEqual({ name: 'Sample Client', phone: '+16315550100', email: 'sample.party@example.com' })
    expect(c.when).toBe('Thu, Dec 24 · 12:00 PM')
    expect(c.type).toMatch(/studio/i)
    expect(c.child).toEqual({ name: 'Sample Child', age: 7 })
    expect(c.guests).toBe(12)
    expect(c.status).toBe('New, awaiting deposit')
    expect(c.theme.map(l => l.text)).toEqual(['Glow Party ($950.00)'])
    expect(c.activities).toEqual([])
    expect(c.addOns).toEqual([])
    expect(c.food).toEqual([])
    expect(c.desserts).toEqual([])
    expect(c.extraGuests).toEqual({ count: 2, amountCents: 7000, text: '2 ($70.00)' })
    expect([c.totalCents, c.paidCents, c.owedCents, c.tipCents]).toEqual([102000, 0, 102000, 0])
    expect(dollars(c.totalCents)).toBe('$1,020.00')
    // Display only: no sign-in link, no token, no admin scratch.
    expect(JSON.stringify(c)).not.toMatch(/token=|portal\/auth|admin scratch/)
  })

  it('sorts line items into theme, activities, add-ons, food and desserts by category', async () => {
    tables.booking_line_items = [
      item('Glow Party', 'theme', 95000),
      item('Canvas Painting', 'activity-add-on', 0),
      item('Bagel Platter', 'food-add-on', 6000, 2),
      item('Coffee Bar', 'beverage-add-on', 4000),
      item('Cake Pops', 'dessert-add-on', 3000),
      item('Balloon Garland', 'decor-add-on', 12000),
      item('Face Painter', 'entertainment-add-on', 15000),
      item('Member discount', 'discount', -5000),
    ]
    const r = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.card.activities.map(l => l.name)).toEqual(['Canvas Painting'])
    expect(r.card.food.map(l => l.text)).toEqual(['Bagel Platter ×2 ($120.00)', 'Coffee Bar ($40.00)'])
    expect(r.card.desserts.map(l => l.name)).toEqual(['Cake Pops'])
    expect(r.card.addOns.map(l => l.name)).toEqual(['Balloon Garland', 'Face Painter'])
    expect(r.card.discounts.map(l => l.text)).toEqual(['Member discount (-$50.00)'])
    expect(r.card.extraGuests).toBeNull()
  })

  it('reads the tip from the payments, and the money from the invoice', async () => {
    tables.booking_payments = [{ booking_id: BOOKING.id, tip_cents: 2000 }, { booking_id: BOOKING.id, tip_cents: 500 }]
    mockInvoice.mockResolvedValue(invoice({ paidCents: 25000, outstandingCents: 77000 }))
    const r = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    if (r.kind !== 'ok') throw new Error('unavailable')
    expect(r.card.tipCents).toBe(2500)
    expect([r.card.paidCents, r.card.owedCents]).toEqual([25000, 77000])
    expect(r.card.status).toBe('Booked, deposit paid')
    // An old quote that is still waiting reads as a quote, not as new.
    mockInvoice.mockResolvedValue(invoice({}, { created_at: '2026-09-01T12:00:00Z' }))
    const old = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    expect(old.kind === 'ok' && old.card.status).toBe('Quote sent, awaiting deposit')
  })

  it('titles a party with no child by its client, and a name ending in s correctly', async () => {
    mockInvoice.mockResolvedValue(invoice({}, { child_name: null }))
    const a = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    expect(a.kind === 'ok' && a.card.title).toBe('Party for Sample Client')
    mockInvoice.mockResolvedValue(invoice({}, { child_name: 'Chris' }))
    const b = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    expect(b.kind === 'ok' && b.card.title).toBe("Chris' Party")
  })

  it('says unavailable rather than showing a card it could not complete', async () => {
    failItems = true
    expect((await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)).kind).toBe('unavailable')
    mockInvoice.mockResolvedValue({ ok: false, notFound: true })
    expect((await loadPartyCard(fakeDb as never, 'HH-NOPE', NOW)).kind).toBe('absent')
  })
})

describe('the card shows up when the party is looked at', () => {
  const ctx = { actor: 'admin:a@example.com', supabase: fakeDb as never, now: NOW }

  it('get_party carries the card; the model still gets its own masked answer', async () => {
    const out = await runAssistantTool('get_party', { booking_ref: 'HH-PTY-CARD1' }, ctx)
    expect(out.partyCards).toHaveLength(1)
    expect(out.partyCards![0].ref).toBe('HH-PTY-CARD1')
    // The card holds the contact in full for the admin's screen; the model's result is what it always was.
    expect(JSON.stringify(out.result)).not.toContain('partyCards')
  })

  it('a card that cannot be built never fails the lookup', async () => {
    failItems = true
    const out = await runAssistantTool('get_party', { booking_ref: 'HH-PTY-CARD1' }, ctx)
    expect(out.isError).toBeFalsy()
    expect(out.partyCards).toBeUndefined()
  })

  it('a refused lookup shows no card', async () => {
    mockInvoice.mockResolvedValue({ ok: false, notFound: true })
    const out = await runAssistantTool('get_party', { booking_ref: 'HH-NOPE' }, ctx)
    expect(out.isError).toBe(true)
    expect(out.partyCards).toBeUndefined()
  })

  it('the chat route stores the cards with the reply, at most three, one per party', () => {
    const run = decomment(fs.readFileSync(path.join(process.cwd(), 'src/lib/assistant/run.ts'), 'utf8'))
    expect(run).toMatch(/const MAX_PARTY_CARDS = 3/)
    expect(run).toMatch(/!parties\.some\(p => p\.ref === c\.ref\)/)
    const route = decomment(fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/assistant/route.ts'), 'utf8'))
    expect(route).toMatch(/parties: turn\.parties/)
  })
})

describe('the card, drawn', () => {
  it('prints the labels in the order the manager wants them', async () => {
    const r = await loadPartyCard(fakeDb as never, 'HH-PTY-CARD1', NOW)
    if (r.kind !== 'ok') throw new Error('unavailable')
    const html = renderToStaticMarkup(createElement(PartyCardView, { party: r.card }))
    const order = [
      "Sample Child&#x27;s Party", 'Contact Name:', 'Phone:', 'Email:', 'When:', 'Type:', 'Child&#x27;s Name / Age:', 'Guests:', 'Status:',
      'Theme:', 'Activities:', 'Add-ons:', 'Food:', 'Desserts:', 'Extra guests:', 'Total:', 'Paid:', 'Owed:', 'Tip:',
    ]
    const at = order.map(s => html.indexOf(s))
    expect(at.filter(i => i < 0).length).toBe(0)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html).toContain('Glow Party ($950.00)')
    expect(html).toContain('2 ($70.00)')
    expect(html).toContain('$1,020.00')
    expect(html).toContain('href="mailto:sample.party@example.com"')
    expect(html).toContain('href="tel:+16315550100"')
  })

  it('is mounted for a reply\'s parties and for a created party', () => {
    const chat = decomment(fs.readFileSync(path.join(process.cwd(), 'src/components/admin/AssistantChat.tsx'), 'utf8'))
    expect(chat).toMatch(/line\.parties\?\.map\(p => \(\s*<PartyCardView/)
    expect(chat).toMatch(/card\.party && \(/)
  })
})

describe('creating a party', () => {
  const req = () => new NextRequest('https://www.example.com/api/admin/assistant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' } })
  const card = () => mintProposal({ kind: 'create_party', input: { contactName: 'Sample Client', contactEmail: 'sample.party@example.com' }, title: 't', details: [], actor: 'admin:a@example.com' }).proposal
  const made = () =>
    mockCreate.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, bookingRef: 'HH-PTY-CARD1', bookingId: BOOKING.id, adminUrl: 'https://www.example.com/admin?tab=parties&ref=HH-PTY-CARD1', builderUrl: 'https://www.example.com/api/portal/auth?ref=X&token=T' }), { status: 200 }),
    )

  it('adds the invoice link and the full card to the result', async () => {
    made()
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, portalUrl: 'https://www.example.com/api/portal/auth?ref=HH-PTY-CARD1&token=I&redirect=%2Fplan%2FHH-PTY-CARD1%2Fsummary' }), { status: 200 }))
    const r = await executeProposal(req(), card())
    expect(r.ok).toBe(true)
    expect(r.links!.map(l => l.label)).toEqual(['Open in admin', 'Invoice link', 'Open the planner'])
    const sent = JSON.parse(await (mockPost.mock.calls[0][0] as NextRequest).text())
    expect(sent).toEqual({ action: 'generate_portal_url', destination: 'invoice' })
    expect(r.party?.title).toBe("Sample Child's Party")
    expect(r.message).toBe('Created HH-PTY-CARD1.')
  })

  it('still reports the party when the invoice link cannot be made, and says so', async () => {
    made()
    mockPost.mockResolvedValue(new Response(JSON.stringify({ error: 'down' }), { status: 503 }))
    const r = await executeProposal(req(), card())
    expect(r.ok).toBe(true)
    expect(r.links!.some(l => l.label === 'Invoice link')).toBe(false)
    expect(r.message).toMatch(/invoice link could not be made/i)
  })
})

describe('the Copy button', () => {
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  afterEach(() => {
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav)
    else delete (globalThis as { navigator?: unknown }).navigator
  })

  it('copyText says true only when the text really went to the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true })
    expect(await copyText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } }, configurable: true })
    expect(await copyText('hello')).toBe(false) // and there is no document to fall back on here
  })

  it('shows a check and "Copied" after success, then goes back; a refusal is never shown as a check', () => {
    const s = decomment(fs.readFileSync(path.join(process.cwd(), 'src/components/admin/CopyButton.tsx'), 'utf8'))
    expect(s).toMatch(/const ok = await copyText\(text\)/)
    expect(s).toMatch(/setState\(ok \? 'copied' : 'failed'\)/)
    expect(s).toMatch(/setTimeout\(\(\) => setState\('idle'\), 2000\)/)
    expect(s).toMatch(/<Check size=\{12\}[^>]*\/> Copied/)
    // Every Copy in the chat is this one component; the old bare clipboard call is gone.
    const chat = decomment(fs.readFileSync(path.join(process.cwd(), 'src/components/admin/AssistantChat.tsx'), 'utf8'))
    expect(chat).toMatch(/<CopyButton text=\{l\.url\} \/>/)
    expect(chat).not.toMatch(/navigator\.clipboard/)
  })

  it('the Leads and Bookings copy button (one component) ticks too', () => {
    const s = decomment(fs.readFileSync(path.join(process.cwd(), 'src/app/admin/crew/_components/PartyActions.tsx'), 'utf8'))
    expect(s).toMatch(/if \(await copyText\(url\)\)/)
    expect(s).toMatch(/copied \? '✓ Copied'/)
  })
})

describe('the crew app: Sign out is on the Profile line', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

  it('is gone from the header and sits right-justified beside the Profile heading', () => {
    expect(read('app/crew/_components/CrewTop.tsx')).not.toMatch(/ActionButton|Sign out/)
    const p = read('app/crew/profile/page.tsx')
    expect(p).toMatch(/<div className="crew-title-row">\s*<h1>Profile<\/h1>\s*<ActionButton endpoint="\/api\/crew\/auth\/logout" label="Sign out"/)
    // The onboarding variant of the header does not carry a second one.
    expect((p.match(/label="Sign out"/g) ?? []).length).toBe(1)
    const layout = read('app/crew/layout.tsx')
    expect(layout).toMatch(/\.crew-title-row\{display:flex;align-items:center;justify-content:space-between/)
  })
})
