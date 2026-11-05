/**
 * The public MCP endpoint (lib/mcp/server.ts, /api/mcp).
 *
 * The routes it replays are mocked: what is under test is the protocol, the
 * screening in front of `start_inquiry`, and that the one write goes through
 * the website's own lead route and nowhere else.
 */
import fs from 'fs'
import path from 'path'
import { decomment } from '../helpers/sourceScan'

const leadPost = jest.fn()
jest.mock('@/app/api/lead/route', () => ({ POST: (...a: unknown[]) => leadPost(...a) }))
jest.mock('@/app/llms.txt/route', () => ({ GET: async () => new Response('# Overview text') }))
jest.mock('@/app/api/availability/route', () => ({
  GET: async () => Response.json({ blockedDates: ['2099-06-13'], configured: true }),
}))
jest.mock('@/app/api/events/route', () => ({
  GET: async () => Response.json({ events: [{ title: 'Bingo', slug: 'bingo', event_date: '2099-01-01', price_cents: 4500 }] }),
}))
jest.mock('@/lib/partyCostFaq', () => ({
  loadStudioThemes: async () => [{ name: 'Slime', slug: 'slime', price_cents: 59500, description: 'Gooey', pricing_item_id: null }],
}))

import { handleRpc, listTools, MCP_PROTOCOL_VERSIONS } from '@/lib/mcp/server'

const req = new Request('https://www.example.com/api/mcp', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4' } })
const ON = {} as NodeJS.ProcessEnv
const OFF = { FEATURE_PUBLIC_MCP_INQUIRY: 'false' } as unknown as NodeJS.ProcessEnv

async function call(name: string, args: unknown, env = ON) {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, req, env)
  return (r as { result: { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> } }).result
}

beforeEach(() => leadPost.mockReset())

describe('protocol', () => {
  it('initialize negotiates a version and advertises tools', async () => {
    const r = (await handleRpc(
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      req,
      ON,
    )) as { result: { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } } }
    expect(r.result.protocolVersion).toBe('2025-06-18')
    expect(r.result.capabilities.tools).toBeDefined()
    const unknown = (await handleRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, req, ON)) as {
      result: { protocolVersion: string }
    }
    expect(unknown.result.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0])
  })

  it('a notification gets no reply; an unknown method is -32601; garbage is -32600', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, req, ON)).toBeNull()
    expect(await handleRpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, req, ON)).toMatchObject({ error: { code: -32601 } })
    expect(await handleRpc({ id: 3, method: 'ping' }, req, ON)).toMatchObject({ error: { code: -32600 } })
    expect(await handleRpc({ jsonrpc: '2.0', id: 4, method: 'ping' }, req, ON)).toEqual({ jsonrpc: '2.0', id: 4, result: {} })
  })

  it('tools/list: read tools are marked read-only; start_inquiry exists only when enabled', () => {
    const on = listTools(ON)
    expect(on.map(t => t.name)).toContain('start_inquiry')
    for (const t of on.filter(t => t.name !== 'start_inquiry')) expect(t.annotations.readOnlyHint).toBe(true)
    expect(listTools(OFF).map(t => t.name)).not.toContain('start_inquiry')
  })

  it('calling a tool that is not listed is refused', async () => {
    const r = await handleRpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'start_inquiry', arguments: {} } },
      req,
      OFF,
    )
    expect(r).toMatchObject({ error: { code: -32602 } })
    expect(leadPost).not.toHaveBeenCalled()
  })
})

describe('read tools', () => {
  it('overview is the llms.txt document', async () => {
    expect((await call('get_business_overview', {})).content[0].text).toBe('# Overview text')
  })

  it('availability: blocked, open, past and malformed dates', async () => {
    expect((await call('check_date_availability', { date: '2099-06-13' })).structuredContent).toMatchObject({ available: false })
    expect((await call('check_date_availability', { date: '2099-06-14' })).structuredContent).toMatchObject({ available: true })
    expect((await call('check_date_availability', { date: '2001-01-01' })).structuredContent).toMatchObject({ available: false })
    expect((await call('check_date_availability', { date: 'next saturday' })).isError).toBe(true)
  })

  it('themes and events come back with prices from their loaders', async () => {
    expect((await call('list_party_themes', {})).structuredContent).toMatchObject({ studio_themes: [{ name: 'Slime', from_price: '$595' }] })
    expect((await call('list_upcoming_events', {})).structuredContent).toMatchObject({ events: [{ title: 'Bingo', from_price: '$45' }] })
  })
})

describe('start_inquiry', () => {
  const good = { full_name: 'Pat Example', email: 'pat@example.com', phone: '631-555-0100', event_type: 'Kids Birthday Party', guest_count: 12 }

  it('refuses missing contact details without touching the lead route', async () => {
    for (const bad of [{}, { ...good, email: undefined }, { ...good, event_type: 'Wedding' }, { ...good, preferred_date: 'soon' }]) {
      expect((await call('start_inquiry', bad)).isError).toBe(true)
    }
    expect(leadPost).not.toHaveBeenCalled()
  })

  it('replays POST /api/lead with MCP attribution and no marketing consent', async () => {
    leadPost.mockResolvedValue(Response.json({ success: true }))
    const r = await call('start_inquiry', { ...good, preferred_date: '2099-06-14' })
    expect(r.isError).toBeFalsy()
    expect(leadPost).toHaveBeenCalledTimes(1)
    const sent = leadPost.mock.calls[0][0] as Request
    expect(new URL(sent.url).pathname).toBe('/api/lead')
    expect(sent.headers.get('cf-connecting-ip')).toBe('1.2.3.4')
    const body = await sent.json()
    expect(body).toMatchObject({
      fullName: 'Pat Example',
      eventType: 'Kids Birthday Party',
      preferredDate: '2099-06-14',
      sourcePage: 'ai-assistant-mcp',
      heardAbout: 'ai_assistant',
      marketingConsent: false,
      utm: { utm_source: 'mcp' },
    })
  })

  it('a failed or throttled lead route is reported as a failure, never as sent', async () => {
    leadPost.mockResolvedValue(Response.json({ error: 'We could not save' }, { status: 503 }))
    expect((await call('start_inquiry', good)).isError).toBe(true)
    leadPost.mockResolvedValue(Response.json({ error: 'slow down' }, { status: 429 }))
    expect((await call('start_inquiry', good)).isError).toBe(true)
  })
})

describe('the route', () => {
  it('rate-limits and feature-gates before it parses anything', () => {
    const s = decomment(fs.readFileSync(path.join(process.cwd(), 'src/app/api/mcp/route.ts'), 'utf8'))
    const post = s.slice(s.indexOf('export async function POST'))
    const flag = post.indexOf("featureEnabled('publicMcp')")
    const limit = post.indexOf('guardRate(req, mcpRule)')
    const parse = post.indexOf('req.text()')
    expect(flag).toBeGreaterThan(0)
    expect(flag).toBeLessThan(limit)
    expect(limit).toBeLessThan(parse)
  })

  it('the only write in the MCP server is the replayed lead route', () => {
    const s = decomment(fs.readFileSync(path.join(process.cwd(), 'src/lib/mcp/server.ts'), 'utf8'))
    expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(s).not.toMatch(/getSupabase|from '@\/lib\/supabase'/)
    // The two database reads live in readers.ts, which is read-only and delegates to the shared implementations.
    const readers = decomment(fs.readFileSync(path.join(process.cwd(), 'src/lib/mcp/readers.ts'), 'utf8'))
    expect(readers.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(readers).toMatch(/quoteFromCatalog\(/)
    expect(readers).toMatch(/findPhotos\(/)
    expect(s.match(/from '@\/app\/api\/[^']+'/g)?.sort()).toEqual([
      "from '@/app/api/availability/route'",
      "from '@/app/api/events/route'",
      "from '@/app/api/lead/route'",
    ])
  })
})
