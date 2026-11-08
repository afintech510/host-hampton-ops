/**
 * The Host Assistant's tools (lib/chat/tools.ts), driven with the REAL quote engine
 * over a fixture catalog and every outside door faked.
 */
import { FALLBACK_CATALOG } from '@/lib/pricingCatalog'
import { buildQuoteItems } from '@/lib/quoteEngine'
import { quoteFromCatalog, type LoadedCatalog } from '@/lib/quoteRequest'
import type { PricingItem } from '@/components/QuoteBuilder/types'

const item = (id: string, name: string, category: string, price_cents: number, price_type: PricingItem['price_type'] = 'flat'): PricingItem => ({
  id, name, description: null, category, price_cents, price_label: null, price_type, is_popular: false, sort_order: 0, emoji: null,
})
const groups = {
  themes: [item('00000000-0000-4000-8000-000000000001', 'Glow Party', 'party-theme', 85000)],
  premiumActivities: [item('00000000-0000-4000-8000-000000000002', 'Slime Making', 'activity-premium', 0)],
  standardActivities: [item('00000000-0000-4000-8000-000000000003', 'Glitter Tattoos', 'activity-standard', 0)],
  food: [item('00000000-0000-4000-8000-000000000004', 'Pizza', 'food-add-on', 1200, 'per_person')], desserts: [item('00000000-0000-4000-8000-000000000005', 'Cupcakes', 'dessert-add-on', 3000)],
  beverages: [], decor: [], entertainment: [], partyAddOns: [],
}
const loaded: LoadedCatalog = { cat: FALLBACK_CATALOG, groups, items: buildQuoteItems(groups) }

const quoteParty = jest.fn(async (req: never) => ({ kind: 'ok', answer: quoteFromCatalog(loaded, req) }))
const photosFor = jest.fn()
jest.mock('@/lib/mcp/readers', () => ({ quoteParty: (r: never) => quoteParty(r), photosFor: (q: unknown) => photosFor(q) }))
const mcpCall = jest.fn()
jest.mock('@/lib/mcp/server', () => ({ callTool: (...a: unknown[]) => mcpCall(...a) }))
const leadPost = jest.fn()
jest.mock('@/app/api/lead/route', () => ({ POST: (r: unknown) => leadPost(r) }))
const claimInquiry = jest.fn()
const markInquiry = jest.fn()
const releaseInquiry = jest.fn()
jest.mock('@/lib/chat/session', () => ({
  claimInquiry: (...a: unknown[]) => claimInquiry(...a),
  markInquiry: (...a: unknown[]) => markInquiry(...a),
  releaseInquiry: (...a: unknown[]) => releaseInquiry(...a),
}))

import { CHAT_TOOLS, runChatTool, WRITE_TOOLS, PROPOSE_TOOLS, type ChatCard, type ChatToolContext } from '@/lib/chat/tools'
import { verifyCard } from '@/lib/chat/card'

const NOW = new Date('2026-11-04T15:00:00Z')
const SID = '11111111-1111-4111-8111-111111111111'

// A Supabase that throws if anything is read or written: propose_booking must touch no table.
const touched: string[] = []
const noTables = new Proxy({}, { get: (_t, p) => { touched.push(String(p)); throw new Error(`supabase.${String(p)} called`) } }) as never

function ctx(said: string[], cards: ChatCard[] = []): ChatToolContext {
  return { supabase: noTables, req: new Request('https://www.example.com/api/chat', { method: 'POST' }), sessionId: SID, visitorSaid: said, cards, now: NOW }
}

const SAID = ['hi! my name is Pat Example, pat@example.com, 631-555-0100. Glow party for 10 kids on 2026-12-12']
const PROPOSE = {
  contact_name: 'Pat Example', contact_email: 'pat@example.com', contact_phone: '(631) 555-0100',
  party_date: '2026-12-12', guests: 10, theme: 'Glow Party', activities: ['Slime Making'], add_ons: ['Cupcakes'],
}

beforeEach(() => {
  jest.clearAllMocks()
  touched.length = 0
  mcpCall.mockResolvedValue({ content: [{ type: 'text', text: '' }], structuredContent: { date: '2026-12-12', available: true } })
  claimInquiry.mockResolvedValue('claimed')
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret'
})

describe('the tool list', () => {
  it('has exactly the public tools, the one proposal tool and the one write tool', () => {
    expect(CHAT_TOOLS.map(t => t.name).sort()).toEqual(
      ['check_availability', 'check_date_availability', 'find_photos', 'get_booking_link', 'get_business_overview', 'get_party_menu', 'get_quote', 'get_reviews', 'list_party_themes', 'list_upcoming_events', 'propose_booking', 'start_inquiry'],
    )
    expect(WRITE_TOOLS).toEqual(['start_inquiry'])
    expect(PROPOSE_TOOLS).toEqual(['propose_booking'])
  })

  it('no tool accepts a price or a total from the model', () => {
    for (const t of CHAT_TOOLS) {
      expect(JSON.stringify(t.input_schema)).not.toMatch(/price|cents|total|amount|discount/i)
    }
  })

  it('an unknown tool is an error, not a crash', async () => {
    const r = await runChatTool('drop_tables', {}, ctx([]))
    expect(r.isError).toBe(true)
  })
})

describe('get_quote', () => {
  it('prices from the engine, returns the deposit, and reports what it could not match', async () => {
    const r = await runChatTool('get_quote', { party_type: 'studio', guests: 10, theme: 'Glow Party', activities: ['Slime Making', 'Skydiving'], price: 1, total_cents: 5 }, ctx([]))
    expect(r.isError).toBeFalsy()
    const out = r.result as { total: string; deposit_due_to_hold_the_date: string; not_found: string[]; line_items: { item: string }[] }
    expect(out.total).toBe('$950')
    expect(out.not_found).toEqual(['Skydiving'])
    expect(out.deposit_due_to_hold_the_date).toMatch(/^\$\d+/)
    // The model's `price` / `total_cents` never reached the engine.
    expect(quoteParty).toHaveBeenCalledWith({ partyType: 'studio', guests: 10, theme: 'Glow Party', activities: ['Slime Making', 'Skydiving'], mini: false, addOns: [] })
  })
})

describe('get_quote (mobile) and the read tools routed through the MCP server', () => {
  it("a mobile quote is the connector's anchor answer, never the engine's total", async () => {
    mcpCall.mockResolvedValue({ content: [{ type: 'text', text: '' }], structuredContent: { mobile_party: { starts_at: '$850', for_kids: 10 } } })
    const r = await runChatTool('get_quote', { party_type: 'mobile', guests: 12, activities: ['Slime Making'] }, ctx([]))
    expect(r.isError).toBeFalsy()
    expect(quoteParty).not.toHaveBeenCalled()
    expect(mcpCall).toHaveBeenCalledWith('get_quote', { party_type: 'mobile', guests: 12 }, expect.anything())
    expect(r.result).toMatchObject({ mobile_party: { starts_at: '$850' } })
  })

  it("the menu, overview, reviews and events are the MCP server's own tools, called with no arguments", async () => {
    for (const name of ['get_party_menu', 'get_business_overview', 'get_reviews', 'list_upcoming_events']) {
      mcpCall.mockClear()
      await runChatTool(name, { anything: 'ignored' }, ctx([]))
      expect(mcpCall).toHaveBeenCalledWith(name, {}, expect.anything())
    }
  })

  it('check_availability takes a month and nothing else, and refuses a malformed one before calling out', async () => {
    mcpCall.mockClear()
    expect((await runChatTool('check_availability', { month: 'March' }, ctx([]))).isError).toBe(true)
    expect((await runChatTool('check_availability', { month: '2027-13' }, ctx([]))).isError).toBe(true)
    expect(mcpCall).not.toHaveBeenCalled()
    await runChatTool('check_availability', { month: '2027-03', extra: 1 }, ctx([]))
    expect(mcpCall).toHaveBeenCalledWith('check_availability', { month: '2027-03' }, expect.anything())
  })
})

describe('propose_booking', () => {
  it('mints a signed card bound to the session, with the engine\'s prices, and touches no table', async () => {
    const cards: ChatCard[] = []
    const r = await runChatTool('propose_booking', PROPOSE, ctx(SAID, cards))
    expect(r.isError).toBeFalsy()
    expect(touched).toEqual([])
    const out = r.result as { nothing_booked_yet: boolean; total: string; instruction: string }
    expect(out.nothing_booked_yet).toBe(true)
    expect(out.instruction).toMatch(/NOTHING is booked yet/)
    expect(out.instruction).toMatch(/held once the deposit is paid/)

    const booking = cards.find(c => c.type === 'booking')
    expect(booking).toBeDefined()
    const v = verifyCard((booking as { token: string }).token, SID)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.card.totalCents).toBe(85000 + 10000 + 3000)
      expect(v.card.date).toBe('2026-12-12')
      expect(v.card.contact).toEqual({ name: 'Pat Example', email: 'pat@example.com', phone: '(631) 555-0100' })
      expect(v.card.lineItems.length).toBeGreaterThan(0)
    }
  })

  it('refuses contact details the visitor did not type — the model cannot invent or "fix" them', async () => {
    for (const [field, value, needle] of [
      ['contact_email', 'someone.else@example.com', 'email'],
      ['contact_phone', '917-555-0134', 'phone'],
      ['contact_name', 'Pat Invented Surname', 'name'],
    ] as const) {
      const cards: ChatCard[] = []
      const r = await runChatTool('propose_booking', { ...PROPOSE, [field]: value }, ctx(SAID, cards))
      expect(r.isError).toBe(true)
      expect(JSON.stringify(r.result)).toContain(needle)
      expect(cards).toEqual([])
    }
  })

  it('refuses when the visitor typed nothing at all', async () => {
    expect((await runChatTool('propose_booking', PROPOSE, ctx([]))).isError).toBe(true)
  })

  it('refuses a past or impossible date, and a date the calendar says is taken', async () => {
    expect((await runChatTool('propose_booking', { ...PROPOSE, party_date: '2026-11-04' }, ctx(SAID))).isError).toBe(true)
    expect((await runChatTool('propose_booking', { ...PROPOSE, party_date: '2026-02-30' }, ctx(SAID))).isError).toBe(true)
    mcpCall.mockResolvedValue({ content: [], structuredContent: { available: false } })
    const cards: ChatCard[] = []
    const r = await runChatTool('propose_booking', PROPOSE, ctx(SAID, cards))
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.result)).toMatch(/already booked/)
    expect(cards).toEqual([])
  })

  it('an unknown calendar is not an open one (rule 12)', async () => {
    mcpCall.mockResolvedValue({ content: [], structuredContent: { available: null } })
    expect((await runChatTool('propose_booking', PROPOSE, ctx(SAID))).isError).toBe(true)
    mcpCall.mockResolvedValue({ content: [{ type: 'text', text: 'down' }], isError: true })
    expect((await runChatTool('propose_booking', PROPOSE, ctx(SAID))).isError).toBe(true)
  })

  it('a name the engine cannot match makes no card — it is never approximated', async () => {
    const cards: ChatCard[] = []
    const r = await runChatTool('propose_booking', { ...PROPOSE, add_ons: ['Unicorn'] }, ctx(SAID, cards))
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.result)).toContain('Unicorn')
    expect(cards).toEqual([])
  })

  it('a second proposal replaces the first card', async () => {
    const cards: ChatCard[] = []
    await runChatTool('propose_booking', PROPOSE, ctx(SAID, cards))
    await runChatTool('propose_booking', { ...PROPOSE, guests: 12 }, ctx(SAID, cards))
    expect(cards.filter(c => c.type === 'booking')).toHaveLength(1)
  })
})

describe('find_photos', () => {
  it('puts the photos in a card for the widget and tells the model not to paste links', async () => {
    photosFor.mockResolvedValue({ kind: 'ok', photos: [{ url: 'https://x.example/a.webp', alt: 'Glow table' }] })
    const cards: ChatCard[] = []
    const r = await runChatTool('find_photos', { theme: 'glow-party', limit: 99 }, ctx([], cards))
    expect(photosFor).toHaveBeenCalledWith(expect.objectContaining({ themeSlug: 'glow-party', limit: 8 }))
    expect(cards).toEqual([{ type: 'photos', photos: [{ url: 'https://x.example/a.webp', alt: 'Glow table' }], moreUrl: expect.stringContaining('/gallery') }])
    expect(JSON.stringify(r.result)).not.toContain('https://x.example/a.webp')
  })

  it('an unreadable library is an error and no card', async () => {
    photosFor.mockResolvedValue({ kind: 'unavailable' })
    const cards: ChatCard[] = []
    expect((await runChatTool('find_photos', {}, ctx([], cards))).isError).toBe(true)
    expect(cards).toEqual([])
  })
})

describe('start_inquiry', () => {
  const ARGS = { full_name: 'Pat Example', email: 'pat@example.com', phone: '631-555-0100', event_type: 'Mobile Services', notes: 'wants a spa party at home' }

  it('replays the lead form with the chat as its source, only for details the visitor typed', async () => {
    leadPost.mockResolvedValue(Response.json({ success: true }))
    const r = await runChatTool('start_inquiry', ARGS, ctx(SAID))
    expect(r.isError).toBeFalsy()
    const sent = await (leadPost.mock.calls[0][0] as Request).json()
    expect(sent).toMatchObject({ sourcePage: 'website-chat', fullName: 'Pat Example', email: 'pat@example.com', marketingConsent: false })
    expect(sent.notes).toContain('website chat assistant')
    expect(markInquiry).toHaveBeenCalled()
  })

  it('refuses an email the visitor did not type, and never replays the lead form', async () => {
    const r = await runChatTool('start_inquiry', { ...ARGS, email: 'other@example.com' }, ctx(SAID))
    expect(r.isError).toBe(true)
    expect(leadPost).not.toHaveBeenCalled()
    expect(claimInquiry).not.toHaveBeenCalled()
  })

  it('is once per chat, and a failed replay releases the slot', async () => {
    claimInquiry.mockResolvedValue('taken')
    expect((await runChatTool('start_inquiry', ARGS, ctx(SAID))).isError).toBe(true)
    expect(leadPost).not.toHaveBeenCalled()

    claimInquiry.mockResolvedValue('claimed')
    leadPost.mockResolvedValue(Response.json({ error: 'nope' }, { status: 500 }))
    expect((await runChatTool('start_inquiry', ARGS, ctx(SAID))).isError).toBe(true)
    expect(releaseInquiry).toHaveBeenCalled()
    expect(markInquiry).not.toHaveBeenCalled()
  })
})
