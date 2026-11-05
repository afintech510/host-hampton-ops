/** The public MCP tools get_quote, find_photos and get_booking_link (lib/mcp/server.ts → lib/mcp/readers.ts). */
const quoteParty = jest.fn()
const photosFor = jest.fn()
jest.mock('@/lib/mcp/readers', () => ({ quoteParty: (...a: unknown[]) => quoteParty(...a), photosFor: (...a: unknown[]) => photosFor(...a) }))
jest.mock('@/app/api/lead/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/llms.txt/route', () => ({ GET: async () => new Response('x') }))
jest.mock('@/app/api/availability/route', () => ({ GET: async () => Response.json({}) }))
jest.mock('@/app/api/events/route', () => ({ GET: async () => Response.json({}) }))
jest.mock('@/lib/partyCostFaq', () => ({ loadStudioThemes: async () => [] }))

import { handleRpc, listTools } from '@/lib/mcp/server'

const req = new Request('https://www.example.com/api/mcp', { method: 'POST' })
async function call(name: string, args: unknown) {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, req, {} as NodeJS.ProcessEnv)
  return (r as { result: { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, any> } }).result
}
beforeEach(() => { quoteParty.mockReset(); photosFor.mockReset() })

describe('tool list', () => {
  it('lists the three new tools, all read-only', () => {
    const tools = listTools({} as NodeJS.ProcessEnv)
    for (const n of ['get_quote', 'find_photos', 'get_booking_link']) {
      const t = tools.find(x => x.name === n)
      expect(t?.annotations.readOnlyHint).toBe(true)
    }
    expect(tools.find(t => t.name === 'get_quote')?.inputSchema).toMatchObject({ required: ['party_type', 'guests'] })
  })
})

describe('get_quote', () => {
  const answer = {
    ok: true, theme: 'Glow Party', activities: [], addOns: [], unmatched: ['Skydiving'], ambiguous: [], travelNotIncluded: false,
    plannerUrl: 'https://www.example.com/party-builder?q=abc',
    quote: { totalCents: 85000, effectiveGuestCount: 10, lineItems: [{ name: 'Glow Party', quantity: 1, unit_price_cents: 85000, guest_multiplied: false }] },
  }

  it('passes names and a guest count through, never a price, and says what it could not match', async () => {
    quoteParty.mockResolvedValue({ kind: 'ok', answer })
    const r = await call('get_quote', { party_type: 'studio', guests: 10, theme: 'Glow Party', activities: ['Skydiving', 7], price: 1, total_cents: 5 })
    expect(quoteParty).toHaveBeenCalledWith({ partyType: 'studio', guests: 10, theme: 'Glow Party', activities: ['Skydiving'], mini: false, addOns: [] })
    expect(r.structuredContent).toMatchObject({ total: '$850', total_cents: 85000, not_found: ['Skydiving'], open_in_planner: answer.plannerUrl })
    expect(JSON.stringify(r.structuredContent!.notes)).toMatch(/NOT in the total/)
    expect(JSON.stringify(r.structuredContent!.notes)).toMatch(/not a booking/)
  })

  it('a refusal from the quote layer is an error result, and an unreadable price list is a polite error', async () => {
    quoteParty.mockResolvedValue({ kind: 'ok', answer: { ok: false, error: 'No theme named "x".' } })
    expect(await call('get_quote', { party_type: 'studio', guests: 10, theme: 'x' })).toMatchObject({ isError: true })
    quoteParty.mockResolvedValue({ kind: 'unavailable' })
    const r = await call('get_quote', { party_type: 'studio', guests: 10, theme: 'x' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/could not be read/)
  })
})

describe('find_photos', () => {
  it('returns links and descriptions, bounds the limit, and falls back to the gallery when none match', async () => {
    photosFor.mockResolvedValue({ kind: 'ok', photos: [{ url: 'https://x/a.webp', alt: 'Glow table', partyType: 'in_studio_theme', themeSlug: 'glow-party', activities: [], igPermalink: null }] })
    const r = await call('find_photos', { theme: 'glow-party', limit: 500 })
    expect(photosFor).toHaveBeenCalledWith(expect.objectContaining({ themeSlug: 'glow-party', limit: 8 }))
    expect(r.content[0].text).toContain('https://x/a.webp')
    photosFor.mockResolvedValue({ kind: 'ok', photos: [] })
    expect((await call('find_photos', {})).content[0].text).toMatch(/gallery/)
    photosFor.mockResolvedValue({ kind: 'unavailable' })
    expect((await call('find_photos', {})).isError).toBe(true)
  })
})

describe('get_booking_link', () => {
  it('gives the planner, the form and the phone, and never says a date is reserved', async () => {
    const r = await call('get_booking_link', {})
    expect(r.structuredContent).toMatchObject({ plan_and_book: expect.stringContaining('/party-builder'), inquiry_form: expect.stringContaining('/book') })
    expect(r.structuredContent!.note).toMatch(/deposit/)
    expect(JSON.stringify(r)).not.toMatch(/\breserved for you\b/)
  })
})
