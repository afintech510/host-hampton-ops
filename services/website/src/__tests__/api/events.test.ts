/**
 * Tests for GET /api/events and GET /api/events/[slug]
 */

import { sampleEvent, sampleFreeEvent, sampleSessionEvent, sampleSession } from '../mocks/fixtures'

// Chain builder for Supabase mock
function buildChain(resolveValue: any) {
  const chain: any = {}
  const methods = ['select', 'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'order', 'limit', 'single', 'in']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  const p = Promise.resolve(resolveValue)
  chain.then = p.then.bind(p)
  chain.catch = p.catch.bind(p)
  return chain
}

const mockGetSupabase = jest.fn()

jest.mock('@/lib/supabase', () => ({
  getSupabase: (...args: any[]) => mockGetSupabase(...args),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status || 200,
      json: () => body,
      body,
    }),
  },
}))

// Import route handlers AFTER mocks are set up
import { GET as getEvents } from '@/app/api/events/route'
import { GET as getEventBySlug } from '@/app/api/events/[slug]/route'

describe('GET /api/events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns active events ordered by date', async () => {
    const eventsChain = buildChain({ data: [sampleEvent, sampleFreeEvent], error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventsChain) })

    const req = { nextUrl: new URL('http://localhost:3002/api/events') } as any
    const response = await getEvents(req)
    const body = response.json()

    expect(body.events).toBeDefined()
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('filters by category when provided', async () => {
    const eventsChain = buildChain({ data: [sampleEvent], error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventsChain) })

    const req = { nextUrl: new URL('http://localhost:3002/api/events?category=workshop') } as any
    await getEvents(req)

    expect(eventsChain.eq).toHaveBeenCalledWith('category', 'workshop')
  })

  it('does not filter when category is "all"', async () => {
    const eventsChain = buildChain({ data: [sampleEvent, sampleFreeEvent], error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventsChain) })

    const req = { nextUrl: new URL('http://localhost:3002/api/events?category=all') } as any
    await getEvents(req)

    const eqCalls = eventsChain.eq.mock.calls
    const categoryCalls = eqCalls.filter((call: any[]) => call[0] === 'category')
    expect(categoryCalls).toHaveLength(0)
  })

  it('returns empty array on error', async () => {
    const eventsChain = buildChain({ data: null, error: { message: 'DB error' } })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventsChain) })

    const req = { nextUrl: new URL('http://localhost:3002/api/events') } as any
    const response = await getEvents(req)
    const body = response.json()

    expect(body.events).toEqual([])
  })

  it('fetches sessions for has_sessions events', async () => {
    const sessionChain = buildChain({ data: [sampleSession], error: null })
    const eventsChain = buildChain({ data: [sampleSessionEvent], error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'event_sessions') return sessionChain
      return eventsChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const req = { nextUrl: new URL('http://localhost:3002/api/events') } as any
    await getEvents(req)

    expect(fromMock).toHaveBeenCalledWith('event_sessions')
  })
})

describe('GET /api/events/[slug]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns event detail by slug', async () => {
    const eventChain = buildChain({ data: sampleEvent, error: null })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventChain) })

    const req = {} as any
    const response = await getEventBySlug(req, { params: { slug: 'embroidery-workshop' } })
    const body = response.json()

    expect(body.event).toBeDefined()
    expect(eventChain.eq).toHaveBeenCalledWith('slug', 'embroidery-workshop')
  })

  it('returns 404 for non-existent slug', async () => {
    const eventChain = buildChain({ data: null, error: { message: 'Not found' } })
    mockGetSupabase.mockReturnValue({ from: jest.fn().mockReturnValue(eventChain) })

    const req = {} as any
    const response = await getEventBySlug(req, { params: { slug: 'nonexistent' } })
    expect(response.status).toBe(404)
  })

  it('fetches sessions when event has_sessions is true', async () => {
    const sessionChain = buildChain({ data: [sampleSession], error: null })
    const eventChain = buildChain({ data: { ...sampleEvent, has_sessions: true }, error: null })

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'event_sessions') return sessionChain
      return eventChain
    })
    mockGetSupabase.mockReturnValue({ from: fromMock })

    const req = {} as any
    const response = await getEventBySlug(req, { params: { slug: 'soft-play' } })
    const body = response.json()

    expect(body.sessions).toBeDefined()
    expect(fromMock).toHaveBeenCalledWith('event_sessions')
  })
})
