import {
  META_CAPI_TIMEOUT_MS,
  META_GRAPH_VERSION_DEFAULT,
  isPublicBeaconEvent,
  metaEventSourceUrl,
  metaGraphVersion,
  metaViewContentBody,
  recordEviteEvent,
  sendMetaViewContent,
} from '@/lib/evites/analytics'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { makeFakeEviteDb } from '../../helpers/fakeEviteDb'

/** A request shape with only what the analytics module reads. */
const reqWith = (headers: Record<string, string>) => {
  const h = new Headers(headers)
  return { headers: { get: (n: string) => h.get(n) } }
}

const ENV_KEYS = ['META_CAPI_ACCESS_TOKEN', 'NEXT_PUBLIC_META_PIXEL_ID', 'META_GRAPH_VERSION'] as const
const saved: Record<string, string | undefined> = {}
const g = globalThis as unknown as { fetch?: unknown }
const realFetch = g.fetch

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  g.fetch = realFetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('the public beacon allow-list', () => {
  it('is exactly invite_viewed and rsvp_started', () => {
    expect(isPublicBeaconEvent('invite_viewed')).toBe(true)
    expect(isPublicBeaconEvent('rsvp_started')).toBe(true)
    for (const bad of ['share_clicked', 'rsvp_completed', 'club_opted_in', 'birthday_month_saved', 'calendar_added', '', 'INVITE_VIEWED', null, undefined, 7, {}, ['invite_viewed']]) {
      expect(isPublicBeaconEvent(bad)).toBe(false)
    }
  })
})

describe('recordEviteEvent', () => {
  it('inserts one PII-free row and says so', async () => {
    const db = makeFakeEviteDb({ tables: {} })
    expect(await recordEviteEvent(db.supabase, 'ev-1', 'invite_viewed')).toBe(true)
    expect(db.inserts).toEqual([{ table: 'evite_events', row: { evite_id: 'ev-1', event: 'invite_viewed' } }])
  })

  it('reads {error}: a failed insert is false and logged, never thrown', async () => {
    const db = makeFakeEviteDb({ tables: {} })
    db.errors.push({ table: 'evite_events', op: 'insert', message: 'boom' })
    await expect(recordEviteEvent(db.supabase, 'ev-1', 'invite_viewed')).resolves.toBe(false)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  it('a client that THROWS is also false, not an exception', async () => {
    const throwing = { from: () => { throw new Error('socket hang up') } } as never
    await expect(recordEviteEvent(throwing, 'ev-1', 'invite_viewed')).resolves.toBe(false)
  })
})

describe('the Graph API version', () => {
  it('comes from META_GRAPH_VERSION; a missing or malformed value falls back to the documented default', () => {
    process.env.META_GRAPH_VERSION = 'v25.0'
    expect(metaGraphVersion()).toBe('v25.0')
    for (const bad of ['', '25.0', 'v25', 'v25.0/../x', 'latest', 'v123.0']) {
      process.env.META_GRAPH_VERSION = bad
      expect(metaGraphVersion()).toBe(META_GRAPH_VERSION_DEFAULT)
    }
    delete process.env.META_GRAPH_VERSION
    expect(metaGraphVersion()).toBe(META_GRAPH_VERSION_DEFAULT)
  })
})

describe('the Conversions API body', () => {
  const req = reqWith({
    'user-agent': 'Mozilla/5.0 (iPhone)',
    'cf-connecting-ip': '203.0.113.9',
    'x-real-ip': '172.70.0.1',
    cookie: 'a=b; _fbp=fb.1.1700000000000.123456789; _fbc=fb.1.1700000000000.AbC-dEf_1; hh_iv_deadbeef=1',
  })
  const body = metaViewContentBody(req, 'TOKEN123', new Date('2026-11-01T15:00:00Z'))
  const event = (body.data as Array<Record<string, unknown>>)[0]

  it('is a single ViewContent for a website with a cleaned URL', () => {
    expect((body.data as unknown[]).length).toBe(1)
    expect(event).toMatchObject({
      event_name: 'ViewContent',
      action_source: 'website',
      event_source_url: `${CANONICAL_ORIGIN}/i/invite`,
      event_time: Math.floor(new Date('2026-11-01T15:00:00Z').getTime() / 1000),
    })
    expect(metaEventSourceUrl()).toBe(`${CANONICAL_ORIGIN}/i/invite`)
    expect(String(event.event_id)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('user_data is UA, IP (cf-connecting-ip first) and the two Meta cookies, nothing else', () => {
    expect(event.user_data).toEqual({
      client_user_agent: 'Mozilla/5.0 (iPhone)',
      client_ip_address: '203.0.113.9',
      fbp: 'fb.1.1700000000000.123456789',
      fbc: 'fb.1.1700000000000.AbC-dEf_1',
    })
  })

  it('carries no slug, name, title, email or phone, and never a hashed email', () => {
    const wire = JSON.stringify(event) // the data, not the token
    for (const forbidden of ['mia', 'glow', 'party', 'pat@example', 'Pat', '631', 'hh_iv_', '/i/mia', ' em"', '"em"', 'CompleteRegistration', 'ph"']) {
      expect(wire.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(Object.keys(event.user_data as object).sort()).toEqual(['client_ip_address', 'client_user_agent', 'fbc', 'fbp'])
  })

  it('falls back to x-real-ip, skips a malformed IP or cookie, and omits what it does not have', () => {
    const sparse = metaViewContentBody(reqWith({ 'cf-connecting-ip': 'not-an-ip', 'x-real-ip': '172.70.0.1', cookie: '_fbp=<script>' }), 't')
    expect((sparse.data as Array<{ user_data: object }>)[0].user_data).toEqual({ client_ip_address: '172.70.0.1' })
  })

  it('a different request gets a different event_id', () => {
    const again = metaViewContentBody(req, 'TOKEN123')
    expect((again.data as Array<{ event_id: string }>)[0].event_id).not.toBe(event.event_id)
  })
})

describe('sendMetaViewContent', () => {
  const req = reqWith({ 'user-agent': 'UA', 'cf-connecting-ip': '203.0.113.9' })
  const configure = () => {
    process.env.META_CAPI_ACCESS_TOKEN = 'TOKEN123'
    process.env.NEXT_PUBLIC_META_PIXEL_ID = '1543468516699272'
    process.env.META_GRAPH_VERSION = 'v23.0'
  }

  it('is a no-op without a token, and without a pixel id: no request at all', async () => {
    const fetchSpy = jest.fn()
    g.fetch = fetchSpy
    configure()
    delete process.env.META_CAPI_ACCESS_TOKEN
    await expect(sendMetaViewContent(req)).resolves.toBe('skipped')
    configure()
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID
    await expect(sendMetaViewContent(req)).resolves.toBe('skipped')
    configure()
    process.env.NEXT_PUBLIC_META_PIXEL_ID = '../../x'
    await expect(sendMetaViewContent(req)).resolves.toBe('skipped')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs to the versioned events endpoint of the pixel, with a body that has the token and the cleaned event', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200 }))
    g.fetch = fetchSpy
    configure()
    await expect(sendMetaViewContent(req)).resolves.toBe('sent')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, { method: string; body: string; signal: AbortSignal }]
    expect(url).toBe('https://graph.facebook.com/v23.0/1543468516699272/events')
    expect(url).not.toContain('TOKEN123') // the token is never in a URL a log could print
    expect(init.method).toBe('POST')
    const parsed = JSON.parse(init.body)
    expect(parsed.access_token).toBe('TOKEN123')
    expect(parsed.data[0].event_source_url).toBe(`${CANONICAL_ORIGIN}/i/invite`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('a non-2xx is "failed" and logs the status only, not the body or the token', async () => {
    g.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => 'echo TOKEN123' }))
    configure()
    await expect(sendMetaViewContent(req)).resolves.toBe('failed')
    const logged = (console.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('400')
    expect(logged).not.toContain('TOKEN123')
  })

  it('a network error never rejects', async () => {
    g.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET TOKEN123')
    })
    configure()
    await expect(sendMetaViewContent(req)).resolves.toBe('failed')
    expect((console.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('TOKEN123')
  })

  it('gives up after 2 seconds: the AbortController fires and the call resolves "failed"', async () => {
    jest.useFakeTimers()
    expect(META_CAPI_TIMEOUT_MS).toBe(2000)
    g.fetch = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        }),
    )
    configure()
    const pending = sendMetaViewContent(req)
    await jest.advanceTimersByTimeAsync(1999)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await jest.advanceTimersByTimeAsync(2)
    await expect(pending).resolves.toBe('failed')
    expect((console.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')).toContain('timed out')
  })
})
